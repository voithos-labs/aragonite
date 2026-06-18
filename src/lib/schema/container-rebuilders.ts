/**
 * Per-container-kind raw rebuilders. Separate from container-raw.ts (the
 * ancestry dispatch) so the built-in registrations can declare rebuildRaw
 * directly: this file imports only core/, while the dispatch must import
 * the registry — same-file would cycle.
 */

import type { CstNode, TableAlignment } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import { concatChildren } from '../core/serializer';

// ── Blockquote ───────────────────────────────────────────────────────────────

/** Rebuild a blockquote's `raw`: `> ` on content lines, `>` on blank lines. */
export function rebuildBlockquoteRaw(node: CstNode): void {
	if (!node.children) return;

	const innerContent =
		(node.innerPrefix ?? '') + concatChildren(node.children) + (node.innerSuffix ?? '');

	node.raw = prefixLines(innerContent, '> ', '>');
}

// ── List ─────────────────────────────────────────────────────────────────────

/**
 * Rebuild a list item's `raw`: first line gets the marker, continuation
 * lines get indentation. Blank lines stay unindented — GFM loose-list form.
 */
export function rebuildListItemRaw(node: CstNode): void {
	if (!node.children || !node.metadata) return;

	const meta = metadataOf(node, 'listItem');
	const marker = meta.marker ?? '- ';
	const taskMarker = meta.taskMarker ?? '';
	const indent = ' '.repeat(marker.length);

	const innerContent =
		(node.innerPrefix ?? '') + concatChildren(node.children) + (node.innerSuffix ?? '');

	const lines = innerContent.split('\n');
	node.raw = lines
		.map((line, i) => {
			if (i === lines.length - 1 && line === '') return '';
			if (i === 0) return marker + taskMarker + line;
			if (line === '') return '';
			return indent + line;
		})
		.join('\n');
}

export function rebuildListRaw(node: CstNode): void {
	if (!node.children) return;
	node.raw = concatChildren(node.children);
}

// ── Table ────────────────────────────────────────────────────────────────────

/** `| c0 | c1 | ... |\n` (single-space padding, trailing newline). */
export function rebuildTableRowRaw(node: CstNode): void {
	if (!node.children) return;
	const cells = node.children.map((c) => c.raw);
	node.raw = '| ' + cells.join(' | ') + ' |\n';
}

/**
 * Header + synthesized canonical delimiter + body rows.
 *
 * Rebuilds every row before assembly so the whole table normalizes to canonical
 * single-space padding on first structural mutation — matches the delimiter-row
 * normalization rule. Without the per-row rebuild, untouched rows would keep
 * their original parser-padded raw and the table would land in a mixed state.
 */
export function rebuildTableRaw(node: CstNode): void {
	if (!node.children) return;
	const meta = metadataOf(node, 'table');
	for (const row of node.children) rebuildTableRowRaw(row);
	const headerRow = node.children[0];
	const bodyRows = node.children.slice(1);

	const delimiterCells = meta.alignments.map(formatAlignmentCell).join(' | ');
	const delimiterLine = '| ' + delimiterCells + ' |\n';

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

function prefixLines(text: string, contentPrefix: string, blankPrefix: string): string {
	const lines = text.split('\n');
	return lines
		.map((line, i) => {
			if (i === lines.length - 1 && line === '') return '';
			if (line === '') return blankPrefix;
			return contentPrefix + line;
		})
		.join('\n');
}
