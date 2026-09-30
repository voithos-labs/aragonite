/**
 * Per-container-kind raw rebuilders. Kept apart from `container-raw.ts`, which walks a node's
 * ancestors, so the built-in registrations can declare `rebuildRaw` directly: this file imports
 * no registry, that walk must, and one file holding both would cycle. The two shared rebuild
 * shapes live in `child-spans.ts`; each kind here adds only its own per-line syntax.
 */

import type { CstNode, TableAlignment } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { firstLineEnding, ownTrailingLineEnding, type LineEnding } from '../core/lines';
import { rebuildConcatRaw, rebuildStripRaw, type ChildRawChange } from './child-spans';

// ── Blockquote ───────────────────────────────────────────────────────────────

/** Rebuild a blockquote's `raw`: `> ` on content lines, `>` on blank lines. */
export function rebuildBlockquoteRaw(node: CstNode, changed?: ChildRawChange): void {
	if (!node.children) return;
	rebuildStripRaw(node, quoteLine, changed);
}

const quoteLine = (text: string): string => (text === '' ? '>' : '> ' + text);

// ── List ─────────────────────────────────────────────────────────────────────

/**
 * Rebuild a list item's `raw`: marker on the first line, indentation on continuations. Separator
 * lines stay bare, but a blank line at the body's end is indented to stay in the item.
 */
export function rebuildListItemRaw(node: CstNode, changed?: ChildRawChange): void {
	if (!node.children || !node.metadata) return;

	const meta = metadataOf(node, 'listItem');
	const marker = meta.marker ?? '- ';
	const taskMarker = meta.taskMarker ?? '';
	const indent = ' '.repeat(marker.length);

	rebuildStripRaw(
		node,
		(text, first, trailingBlank) => {
			if (first) return marker + taskMarker + text;
			return text === '' && !trailingBlank ? '' : indent + text;
		},
		changed
	);
}

export function rebuildListRaw(node: CstNode, changed?: ChildRawChange): void {
	if (!node.children) return;
	rebuildConcatRaw(node, changed);
}

// ── Table ────────────────────────────────────────────────────────────────────

/** `| c0 | c1 | ... |` plus the row's own ending (single-space padding). The table's rebuild,
 *  which writes the table's bytes, gives every row the table's ending. */
export function rebuildTableRowRaw(node: CstNode): void {
	writeTableRow(node, ownTrailingLineEnding(node.raw));
}

/** The ending a table's lines take: a table spans its header and delimiter lines at least, so its
 *  bytes hold the document's ending. */
export function tableLineEnding(table: NodeView): LineEnding {
	return firstLineEnding(table.raw) ?? '\n';
}

/**
 * The row's bytes with the table's line ending, since a row a structural edit created has none of
 * its own. The surplus cells, which GFM does not render, follow the rendered ones.
 */
export function writeTableRow(node: CstNode, lineEnding: string): void {
	if (!node.children) return;
	const surplus = node.metadata ? (metadataOf(node, 'tableRow').surplusCells ?? []) : [];
	const cells = [...node.children.map((c) => c.raw), ...surplus];
	node.raw = '| ' + cells.join(' | ') + ' |' + lineEnding;
}

/**
 * Every row is rebuilt, so the first structural edit normalizes the whole table's padding. The last
 * line of a table that ends the document with no line ending stays open, whichever row holds it.
 */
export function rebuildTableRaw(node: CstNode): void {
	if (!node.children) return;
	const meta = metadataOf(node, 'table');
	const lineEnding = tableLineEnding(node);
	const openTail = ownTrailingLineEnding(node.raw) === '';
	for (const row of node.children) writeTableRow(row, lineEnding);
	const headerRow = node.children[0];
	const bodyRows = node.children.slice(1);
	const lastBodyRow = bodyRows.at(-1);
	if (openTail && lastBodyRow) writeTableRow(lastBodyRow, '');

	const delimiterCells = meta.alignments.map(formatAlignmentCell).join(' | ');
	const delimiterEnding = openTail && !lastBodyRow ? '' : lineEnding;
	const delimiterLine = '| ' + delimiterCells + ' |' + delimiterEnding;

	let raw = (headerRow?.raw ?? '') + delimiterLine;
	for (const r of bodyRows) raw += r.raw;
	node.raw = raw;
}

function formatAlignmentCell(a: TableAlignment): string {
	switch (a) {
		case 'left':
			return ':---';
		case 'center':
			return ':---:';
		case 'right':
			return '---:';
		case 'none':
			return '---';
		default: {
			const _exhaustive: never = a;
			throw new Error(`Unknown alignment: ${_exhaustive}`);
		}
	}
}
