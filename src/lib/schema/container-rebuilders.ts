/**
 * Per-container-kind raw rebuilders. Kept apart from `container-raw.ts`, which walks a node's
 * ancestors, so the built-in registrations can declare `rebuildRaw` directly: this file imports
 * no registry, that walk must, and one file holding both would cycle. The two shared rebuild
 * shapes live in `child-spans.ts`; each kind here adds only its own per-line syntax.
 */

import type { CstNode, TableAlignment } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { assertInvariant } from '../assert';
import { quoteLines } from '../core/parsers/blockquote';
import { listItemLines, readItemShape } from '../core/parsers/list';
import {
	firstDisplayLine,
	firstLineEnding,
	isBlankLine,
	ownTrailingLineEnding,
	trimTrailingLineEnding,
	type LineEnding
} from '../core/lines';
import {
	cellText,
	delimiterCellAlignment,
	delimiterCellSpelling,
	matchTableDelimiterRow,
	rowCellSpans,
	rowEdgePipes,
	spliceCells,
	splitRowCells,
	tableDelimiterLine,
	tableRowLine,
	type CellSpan
} from '../core/parsers/table-line';
import {
	rebuildConcatRaw,
	rebuildStripRaw,
	spliceVerbatimChild,
	type ChildRawChange,
	type StripRebuild
} from './child-spans';

// ── Blockquote ───────────────────────────────────────────────────────────────

export function rebuildBlockquoteRaw(
	node: CstNode,
	changed?: ChildRawChange
): StripRebuild | undefined {
	if (!node.children) return;
	return rebuildStripRaw(node, quoteLines, changed);
}

// ── List ─────────────────────────────────────────────────────────────────────

/** The item's lines written under its metadata, at the indent its own first line had; its
 *  previous bytes are read under the shape that first line was written in. */
export function rebuildListItemRaw(
	node: CstNode,
	changed?: ChildRawChange
): StripRebuild | undefined {
	if (!node.children || !node.metadata) return;
	const meta = metadataOf(node, 'listItem');
	const previous = readItemShape(firstDisplayLine(node.raw).text);
	const shape = {
		indent: previous?.indent ?? '',
		marker: meta.marker ?? '- ',
		taskMarker: meta.taskMarker ?? null
	};
	const lines = listItemLines(shape);
	const unchanged =
		!previous || (previous.marker === shape.marker && previous.taskMarker === shape.taskMarker);
	return rebuildStripRaw(node, lines, changed, unchanged ? lines : listItemLines(previous));
}

export function rebuildListRaw(node: CstNode, changed?: ChildRawChange): void {
	if (!node.children) return;
	rebuildConcatRaw(node, changed);
}

// ── Table ────────────────────────────────────────────────────────────────────

// Each line keeps its own bytes and ending and changes only the cells whose text changed; a line
// with no bytes of its own, or whose rewrite would not read back as its cells, is written plainly.

/** A row rebuilt alone. A row with no bytes is left to its table's rebuild, which knows the
 *  ending the table's lines take. */
export function rebuildTableRowRaw(node: CstNode): void {
	if (isBlankLine(trimTrailingLineEnding(node.raw))) return;
	writeTableRow(node, '');
}

/** A table's header row sits above its delimiter line, so only a body row can hold its last line. */
export function tableLastLineChild(table: NodeView): number {
	const rows = table.children?.length ?? 0;
	return rows > 1 ? rows - 1 : -1;
}

/** The ending a table's lines take: a table spans its header and delimiter lines at least, so its
 *  bytes hold the document's ending. */
export function tableLineEnding(table: NodeView): LineEnding {
	return firstLineEnding(table.raw) ?? '\n';
}

/** The row's cells, surplus included, written into its bytes; a row `followed` by a line takes
 *  `lineEnding` if it has none. A body row narrower than `previousColumns` stays narrow. */
export function writeTableRow(
	node: CstNode,
	lineEnding: string,
	previousColumns = node.children?.length ?? 0,
	followed = false
): void {
	if (!node.children) return;
	const raw = tableRowBytes(node, lineEnding, previousColumns, followed);
	if (raw !== node.raw) node.raw = raw;
}

/** `changed` names the one row that moved since the last rebuild, whose region alone is
 *  rewritten; the full rebuild writes each row and the delimiter line from its own bytes. */
export function rebuildTableRaw(node: CstNode, changed?: ChildRawChange): void {
	if (!node.children) return;
	const children = node.children;
	const lineEnding = tableLineEnding(node);
	// The delimiter line follows the header row, so only a last body row may end the table.
	const followed = (i: number) => i === 0 || i < children.length - 1;
	if (changed) {
		const row = children[changed.index];
		if (row?.children) writeTableRow(row, lineEnding, undefined, followed(changed.index));
		if (spliceVerbatimChild(node, changed, rebuildTableRaw)) return;
	}
	const meta = metadataOf(node, 'table');
	const delimiterBefore = secondLine(node.raw);
	const columnsBefore =
		(delimiterBefore !== null &&
			matchTableDelimiterRow(trimTrailingLineEnding(delimiterBefore))?.columnCount) ||
		meta.columnCount;
	const delimiter = delimiterBytes(
		delimiterBefore,
		meta.alignments,
		lineEnding,
		children.length > 1
	);
	const spans = new Uint32Array(children.length * 2);
	let raw = '';
	for (let i = 0; i < children.length; i++) {
		// One indexed read per row: the array is a `$state` proxy, so every read is a proxy trap.
		const row = children[i];
		if (i === 1) raw += delimiter;
		writeTableRow(row, lineEnding, columnsBefore, followed(i));
		spans[i * 2] = raw.length;
		raw += row.raw;
		spans[i * 2 + 1] = raw.length;
	}
	if (children.length < 2) raw += delimiter;
	node.raw = raw;
	node.childSpans = spans;
}

function tableRowBytes(
	row: CstNode,
	lineEnding: string,
	columnsBefore: number,
	followed: boolean
): string {
	const meta = row.metadata ? metadataOf(row, 'tableRow') : undefined;
	const children = row.children!;
	// A typed edge space is padding to a reader, so the row writes it once, as padding.
	const cells = [...children.map((c) => cellText(c.raw)), ...(meta?.surplusCells ?? [])];
	const text = trimTrailingLineEnding(row.raw);
	const own = ownTrailingLineEnding(row.raw);
	const ending = own || (followed ? lineEnding : '');
	const plain = tableRowLine(cells);
	// A blank line, or more than one, is no row's bytes.
	if (isBlankLine(text) || text.includes('\n')) return plain + (own || lineEnding);
	const spans = rowCellSpans(text);
	const isHeader = meta?.isHeader === true;
	const written = spliceCells(text, spans, {
		before: spans.map((s) => s.text),
		after: cells,
		spell: (cell) => cell,
		mayStayMissing: !isHeader && spans.length < columnsBefore
	});
	if (written === text) return text + ending;
	if (
		readsAsRow(written, cells, children.length, isHeader) &&
		opensAsBefore(written, text, spans)
	) {
		return written + ending;
	}
	// The plain spelling is the fallback, so cells it can't hold are cells no row reads back.
	assertInvariant('table-row-reads-back', () =>
		readsAsRow(plain, cells, children.length, isHeader)
			? null
			: { code: 'table-row-reads-back', message: `a reader takes "${plain}" as other cells` }
	);
	return plain + ending;
}

/** Whether a reader takes `line`'s cells as `cells`: a body row's missing cells read empty, and
 *  a header row has exactly its columns. */
function readsAsRow(line: string, cells: string[], columns: number, isHeader: boolean): boolean {
	const read = splitRowCells(line);
	if (isHeader && read.length !== columns) return false;
	while (read.length < columns) read.push('');
	return read.length === cells.length && read.every((text, i) => text === cells[i]);
}

/** A line with no leading pipe keeps its first cell's bytes, or its new first text could open
 *  another block (`# x`), which only the grammar can tell. */
function opensAsBefore(line: string, before: string, spans: CellSpan[]): boolean {
	const firstCellEnd = spans[0].to;
	return (
		rowEdgePipes(line).leading ||
		(line.startsWith(before.slice(0, firstCellEnd)) && line[firstCellEnd] === '|')
	);
}

function delimiterBytes(
	previous: string | null,
	alignments: TableAlignment[],
	lineEnding: LineEnding,
	rowsFollow: boolean
): string {
	const plain = tableDelimiterLine(alignments);
	if (previous === null) return plain + lineEnding;
	const text = trimTrailingLineEnding(previous);
	// The delimiter is the table's own line, so it ends when a row follows it.
	const ending = ownTrailingLineEnding(previous) || (rowsFollow ? lineEnding : '');
	const spans = rowCellSpans(text);
	const before = spans.map((s) => delimiterCellAlignment(s.text));
	if (before.some((a) => a === null)) return plain + ending;
	// A cell taking another cell's alignment (a column move) takes that cell's spelling too.
	const spellings = new Map<TableAlignment, string>();
	spans.forEach((s, i) => {
		if (!spellings.has(before[i]!)) spellings.set(before[i]!, s.text);
	});
	const written = spliceCells(text, spans, {
		before: before as TableAlignment[],
		after: alignments,
		spell: (a) => spellings.get(a) ?? delimiterCellSpelling(a),
		mayStayMissing: false
	});
	const read = matchTableDelimiterRow(written)?.alignments;
	const reads = read?.length === alignments.length && read.every((a, i) => a === alignments[i]);
	return (reads ? written : plain) + ending;
}

/** The second line of `raw`, its ending included, or null when it has none. */
function secondLine(raw: string): string | null {
	const first = raw.indexOf('\n');
	if (first < 0 || first + 1 === raw.length) return null;
	const second = raw.indexOf('\n', first + 1);
	return second < 0 ? raw.slice(first + 1) : raw.slice(first + 1, second + 1);
}
