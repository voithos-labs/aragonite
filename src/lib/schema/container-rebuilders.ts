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
 * Rebuild a list item's `raw`: marker on the first line, indentation on continuations. A separator
 * line stays unindented; an empty block's line at the body's end is indented, which keeps it
 * inside the item on reload.
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
 * The same bytes with a line ending the row does not carry itself: a row created by a structural
 * edit has none from the source, so the table supplies it. Separate from the rebuilder above
 * because `rebuildRaw`'s second parameter is the changed-child hint. The row's surplus cells,
 * the ones GFM does not render, follow its rendered ones.
 */
export function writeTableRow(node: CstNode, lineEnding: string): void {
	if (!node.children) return;
	const surplus = node.metadata ? (metadataOf(node, 'tableRow').surplusCells ?? []) : [];
	const cells = [...node.children.map((c) => c.raw), ...surplus];
	node.raw = '| ' + cells.join(' | ') + ' |' + lineEnding;
}

/**
 * Header, a rebuilt delimiter row, then the body rows. Every row is rebuilt first, so the first
 * structural edit normalizes the whole table's padding instead of leaving half of it padded. Every
 * line takes the table's ending: a row created by a structural edit has none of its own.
 */
export function rebuildTableRaw(node: CstNode): void {
	if (!node.children) return;
	const meta = metadataOf(node, 'table');
	const lineEnding = tableLineEnding(node);
	for (const row of node.children) writeTableRow(row, lineEnding);
	const headerRow = node.children[0];
	const bodyRows = node.children.slice(1);

	const delimiterCells = meta.alignments.map(formatAlignmentCell).join(' | ');
	const delimiterLine = '| ' + delimiterCells + ' |' + lineEnding;

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
