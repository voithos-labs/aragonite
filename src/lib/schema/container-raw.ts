/**
 * Per-container-kind raw-rebuild helpers plus ancestry dispatch. Each kind's
 * rebuild function is registered on its `BlockKindDescriptor` at this module's
 * load — `rebuildContainerRaw` looks up `descriptor.rebuildRaw` rather than
 * switching on kind, so plugin containers at 1.2 participate by supplying a
 * rebuildRaw on their descriptor.
 */

import type { CstNode, Document, TableAlignment, TableMetadata } from '../core/nodes';
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
 * Rebuild a list item's `raw`: first line gets the marker, continuation
 * lines get indentation. Blank lines stay unindented — GFM loose-list form.
 */
export function rebuildListItemRaw(node: CstNode): void {
	if (!node.children || !node.metadata) return;

	const meta = node.metadata as { marker?: string; taskMarker?: string | null };
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

/** Rebuild a row's raw from its cell children: `| c0 | c1 | ... |\n`. */
export function rebuildTableRowRaw(node: CstNode): void {
	if (!node.children) return;
	const cells = node.children.map((c) => c.raw);
	node.raw = '| ' + cells.join(' | ') + ' |\n';
}

/** Rebuild a table's raw from header + canonical delimiter + body rows. */
export function rebuildTableRaw(node: CstNode): void {
	if (!node.children) return;
	const meta = node.metadata as TableMetadata;
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

/**
 * Rebuild `raw` for every container ancestor of `leafPath`, innermost-first.
 * The leaf itself is not rebuilt — callers mutate the leaf's raw before
 * calling. Stops at depth 1 (document root is never rebuilt; serialization
 * reads its children directly).
 */
export function rebuildAncestryRawForLeaf(doc: Document, leafPath: number[]): void {
	const ancestors: CstNode[] = [];
	let cur: CstNode | Document = doc;
	for (let depth = 0; depth < leafPath.length - 1; depth++) {
		if (!cur.children || leafPath[depth] >= cur.children.length) break;
		cur = cur.children[leafPath[depth]];
		ancestors.push(cur as CstNode);
	}
	for (let i = ancestors.length - 1; i >= 0; i--) {
		rebuildContainerRawIfContainer(ancestors[i]);
	}
}
