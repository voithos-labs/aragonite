/**
 * Per-container-kind raw rebuilders. Separate from container-raw.ts (the ancestry dispatch) so
 * the built-in registrations can declare rebuildRaw directly: this file imports only core/,
 * while the dispatch must import the registry, and same-file would cycle.
 */

import type { CstNode, TableAlignment } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import { concatChildren } from '../core/serializer';
import { splitLines, trailingLineEnding } from '../core/lines';

// ── Blockquote ───────────────────────────────────────────────────────────────

/** Rebuild a blockquote's `raw`: `> ` on content lines, `>` on blank lines. */
export function rebuildBlockquoteRaw(node: CstNode): void {
	if (!node.children) return;

	node.raw = splitLines(innerContentOf(node))
		.map((line) => (line.text === '' ? '>' : '> ' + line.text) + line.lineEnding)
		.join('');
}

// ── List ─────────────────────────────────────────────────────────────────────

/**
 * Rebuild a list item's `raw`: marker on the first line, indentation on continuations. Blank
 * lines stay unindented — GFM loose-list form.
 */
export function rebuildListItemRaw(node: CstNode): void {
	if (!node.children || !node.metadata) return;

	const meta = metadataOf(node, 'listItem');
	const marker = meta.marker ?? '- ';
	const taskMarker = meta.taskMarker ?? '';
	const indent = ' '.repeat(marker.length);

	node.raw = splitLines(innerContentOf(node))
		.map((line, i) => {
			if (i === 0) return marker + taskMarker + line.text + line.lineEnding;
			if (line.text === '') return line.lineEnding;
			return indent + line.text + line.lineEnding;
		})
		.join('');
}

export function rebuildListRaw(node: CstNode): void {
	if (!node.children) return;
	node.raw = concatChildren(node.children);
}

// ── Table ────────────────────────────────────────────────────────────────────

/** `| c0 | c1 | ... |` plus `lineEnding` (single-space padding). */
export function rebuildTableRowRaw(node: CstNode, lineEnding = trailingLineEnding(node.raw)): void {
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
	for (const row of node.children) rebuildTableRowRaw(row, lineEnding);
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The bytes a `strip` container re-prefixes. Both kinds below open their body on the container's
 * OWN first line, so no parse can peel a blank into `innerPrefix` and the slot stays empty
 * (G1.5); reading it would emit a line nobody typed.
 */
function innerContentOf(node: CstNode): string {
	return concatChildren(node.children!) + (node.innerSuffix ?? '');
}
