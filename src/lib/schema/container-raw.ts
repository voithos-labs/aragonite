/**
 * Per-container-kind raw-rebuild helpers plus ancestry dispatch. Each kind's
 * rebuild function is registered on its `BlockKindDescriptor` at this module's
 * load — `rebuildContainerRaw` looks up `descriptor.rebuildRaw` rather than
 * switching on kind, so plugin containers at 1.2 participate by supplying a
 * rebuildRaw on their descriptor.
 */

import type { CstNode, TableAlignment } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import { augmentBlockKind, tryGetBlockKindDescriptor } from './block-kind-descriptor';

// ── Blockquote ───────────────────────────────────────────────────────────────

/** Rebuild a blockquote's `raw`: `> ` on content lines, `>` on blank lines. */
export function rebuildBlockquoteRaw(node: CstNode): void {
	if (!node.children) return;

	const innerContent =
		(node.innerPrefix ?? '') +
		node.children.map((c) => c.leadingTrivia + c.raw).join('') +
		(node.innerSuffix ?? '');

	node.raw = prefixLines(innerContent, '> ', '>');
}

// ── List ─────────────────────────────────────────────────────────────────────

/**
 * G1.7 — metadata fields a container's `rebuildRaw` feeds into `raw`. Writing
 * one of these outside `updateBlockMetadata` (which rebuilds the container)
 * leaves `raw` stale relative to metadata; the stale-raw check (G1.1) at the
 * commit seams catches that on the touched listItem. Kept here next to the
 * rebuild that reads them so the list stays honest as fields are added.
 */
export const RAW_FEEDING_METADATA_FIELDS: Readonly<Record<string, readonly string[]>> = {
	listItem: ['marker', 'taskMarker']
};

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
		(node.innerPrefix ?? '') +
		node.children.map((c) => c.leadingTrivia + c.raw).join('') +
		(node.innerSuffix ?? '');

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
	node.raw = node.children.map((c) => c.leadingTrivia + c.raw).join('');
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

// ── Descriptor wiring ────────────────────────────────────────────────────────

augmentBlockKind('blockquote', { rebuildRaw: rebuildBlockquoteRaw });
augmentBlockKind('list', { rebuildRaw: rebuildListRaw });
augmentBlockKind('listItem', { rebuildRaw: rebuildListItemRaw });
augmentBlockKind('table', { rebuildRaw: rebuildTableRaw });
augmentBlockKind('tableRow', { rebuildRaw: rebuildTableRowRaw });

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

// ── Ancestry dispatch ────────────────────────────────────────────────────────

/**
 * Rebuild `raw` for every container along `path`, innermost first. The leaf
 * at the tail of `path` is NOT rebuilt — callers mutate its raw before calling.
 * Empty path: rebuild just `root`.
 */
export function rebuildAncestryRaw(root: CstNode, path: number[]): void {
	if (path.length === 0) {
		rebuildContainerRaw(root);
		return;
	}

	const containers: CstNode[] = [];
	let current = root;
	for (let i = 0; i < path.length - 1; i++) {
		current = current.children![path[i]];
		containers.push(current);
	}

	for (let i = containers.length - 1; i >= 0; i--) {
		rebuildContainerRaw(containers[i]);
	}
	rebuildContainerRaw(root);
}

/**
 * Dispatch via the kind's descriptor `rebuildRaw`. Throws when the kind has
 * no rebuildRaw (i.e. is a leaf) — callers that walk ancestry chains should
 * use {@link rebuildContainerRawIfContainer} instead.
 */
export function rebuildContainerRaw(node: CstNode): void {
	const rebuild = tryGetBlockKindDescriptor(node.kind)?.rebuildRaw;
	if (!rebuild) {
		throw new Error(
			`rebuildContainerRaw: kind "${node.kind}" has no rebuildRaw — only container kinds are valid`
		);
	}
	rebuild(node);
}

/** Rebuild `raw` when `node` has a rebuildRaw on its descriptor; no-op otherwise. */
export function rebuildContainerRawIfContainer(node: CstNode): void {
	tryGetBlockKindDescriptor(node.kind)?.rebuildRaw?.(node);
}
