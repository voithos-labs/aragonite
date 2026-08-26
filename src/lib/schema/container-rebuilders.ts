/**
 * Per-container-kind raw rebuilders. Separate from container-raw.ts (the ancestry dispatch) so
 * the built-in registrations can declare rebuildRaw directly: this file reaches no registry,
 * while the dispatch must import one, and same-file would cycle. The strip and concat shapes
 * live in child-spans.ts; each kind here contributes only its own per-line syntax.
 */

import type { CstNode, TableAlignment } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import { trailingLineEnding } from '../core/lines';
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
 * Rebuild a list item's `raw`: marker on the first line, indentation on continuations. Blank
 * lines stay unindented — GFM loose-list form.
 */
export function rebuildListItemRaw(node: CstNode, changed?: ChildRawChange): void {
	if (!node.children || !node.metadata) return;

	const meta = metadataOf(node, 'listItem');
	const marker = meta.marker ?? '- ';
	const taskMarker = meta.taskMarker ?? '';
	const indent = ' '.repeat(marker.length);

	rebuildStripRaw(
		node,
		(text, first) => {
			if (first) return marker + taskMarker + text;
			return text === '' ? '' : indent + text;
		},
		changed
	);
}

export function rebuildListRaw(node: CstNode, changed?: ChildRawChange): void {
	if (!node.children) return;
	rebuildConcatRaw(node, changed);
}

// ── Table ────────────────────────────────────────────────────────────────────

/** `| c0 | c1 | ... |` plus the row's own ending (single-space padding). */
export function rebuildTableRowRaw(node: CstNode): void {
	writeTableRow(node, trailingLineEnding(node.raw));
}

/**
 * The same bytes under an ending the row does not own: a row minted by a structural op has no
 * authored one, so the TABLE dictates it. Split from the descriptor-shaped rebuilder above
 * because `rebuildRaw`'s second parameter is the changed-child hint.
 */
export function writeTableRow(node: CstNode, lineEnding: string): void {
	if (!node.children) return;
	const cells = node.children.map((c) => c.raw);
	node.raw = '| ' + cells.join(' | ') + ' |' + lineEnding;
}

/**
 * Header + synthesized canonical delimiter + body rows. Every row is rebuilt before assembly, so
 * the whole table normalizes to canonical padding on first structural mutation rather than
 * landing half-padded. The table's own ending drives every emitted line (G4.20): a row minted by
 * a structural op has no authored ending, so per-row detection would strand it on LF in a CRLF
 * table.
 */
export function rebuildTableRaw(node: CstNode): void {
	if (!node.children) return;
	const meta = metadataOf(node, 'table');
	const lineEnding = trailingLineEnding(node.raw);
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
