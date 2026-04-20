/**
 * Kind-agnostic CST node mutations: path resolution, split, merge, delete,
 * update, and editable-container scaffolding. Kind-specific unwrap and merge
 * live in `list-ops.ts` and `blockquote.ts`; container raw-rebuilds live in
 * `container-raw.ts`.
 *
 * Children-array mutation contract (0.5.5.1):
 *
 * Every tree op that modifies a container's top-level children array MUST take
 * the array as an explicit parameter and mutate it, never `node.children` of
 * the passed-in container node directly. The caller owns the array — typically
 * a copy spread from `node.children` inside `commitContainerStructural`'s
 * mutate callback — and publishes it atomically after the op returns.
 *
 * Why: direct `node.children.splice(...)` inside an op collides with the
 * commit primitive's post-mutate publish, which reassigns a pre-mutation copy
 * back to `node.children`. The M1 zombie-ListItemBlock bug (0.5.4) was exactly
 * this pattern — splice mutated live children, publish overwrote with the old
 * array, and the keyed {#each} rendered a stale component pinned at
 * key=undefined that intercepted typed characters.
 *
 * Scope: the rule applies to the top-level children array the op was handed.
 * Mutations to other nodes reached by walking the live tree during the op —
 * whether descendants (e.g., appending to a nested list found during M1
 * walking) or ancestors (e.g., cascade-cleanup pruning an empty parent) —
 * remain in-place. The commit primitive's snapshot captures the whole subtree
 * via cloneDocument regardless of walk direction, so there is no publish
 * collision. If an op needs to mutate descendants structurally (insert/delete
 * items in a discovered container), it should look up that container's
 * registered BlockListState and route through `commitChildrenEdit`, matching
 * the pattern in `list-context.ts`.
 *
 * Contract audit: before shipping, grep for `.children.splice` and
 * `.children.push` across `tree-operations/` and confirm every hit is either
 * (a) on a caller-passed array parameter, (b) on a NodeParent wrapper, or
 * (c) on a discovered descendant covered by the scope exception above.
 */

import type { CstNode, Document } from '../core/nodes';
import { parse } from '../core/parser';
import { generateBlockId } from './block-id';
import { trimTrailingLineEnding } from '../core/lines';

// ── Types ──

export type NodeParent = { children: CstNode[] };

// ── Path resolution ──

/**
 * Resolve a node by walking a path of child indices from the document root.
 * Returns null if the path does not correspond to an existing node.
 */
export function nodeAt(doc: Document, path: number[]): CstNode | Document | null {
	let cur: CstNode | Document = doc;
	for (const idx of path) {
		if (!cur.children || idx >= cur.children.length) return null;
		cur = cur.children[idx];
	}
	return cur;
}

// ── Split ──

/**
 * Split the node at `blockIndex` into two nodes at the given raw `offset`.
 * The first node keeps the original ID. A new ID is inserted for the second node.
 * Both halves are re-parsed to determine their block type.
 *
 * The offset is relative to the displayed text content (without trailing line ending).
 * The line ending style (\n or \r\n) is preserved from the original raw.
 */
export function splitNode(
	parent: NodeParent,
	blockIds: string[],
	blockIndex: number,
	offset: number
): void {
	const node = parent.children[blockIndex];
	const rawText = node.raw;

	const lineEnding = rawText.endsWith('\r\n') ? '\r\n' : '\n';

	let firstRaw = rawText.slice(0, offset);
	let secondRaw = rawText.slice(offset);

	if (!firstRaw.endsWith('\n')) {
		firstRaw += lineEnding;
	}

	if (secondRaw.length === 0 || !secondRaw.endsWith('\n')) {
		if (secondRaw.length === 0) {
			secondRaw = lineEnding;
		} else {
			secondRaw += lineEnding;
		}
	}

	const firstNode = reparseAsNode(firstRaw, node.leadingTrivia);
	const secondNode = reparseAsNode(secondRaw, '');

	parent.children.splice(blockIndex, 1, firstNode, secondNode);
	blockIds.splice(blockIndex + 1, 0, generateBlockId());
}

// ── Merge ──

/**
 * Merge the node at `blockIndex` into the node at `blockIndex - 1`.
 * The combined raw text is re-parsed. The first block's ID is kept.
 * No-op if blockIndex is 0.
 */
export function mergeWithPrevious(
	parent: NodeParent,
	blockIds: string[],
	blockIndex: number
): void {
	if (blockIndex <= 0 || blockIndex >= parent.children.length) return;

	const prev = parent.children[blockIndex - 1];
	const curr = parent.children[blockIndex];

	const mergedRaw = trimTrailingLineEnding(prev.raw) + curr.raw;
	const mergedNode = reparseAsNode(mergedRaw, prev.leadingTrivia);
	parent.children.splice(blockIndex - 1, 2, mergedNode);
	blockIds.splice(blockIndex, 1);
}

/**
 * Merge the node at `blockIndex` with the node at `blockIndex + 1`.
 * The combined raw text is re-parsed. The current block's ID is kept.
 * No-op if blockIndex is the last block.
 */
export function mergeWithNext(parent: NodeParent, blockIds: string[], blockIndex: number): void {
	if (blockIndex < 0 || blockIndex >= parent.children.length - 1) return;

	const curr = parent.children[blockIndex];
	const next = parent.children[blockIndex + 1];

	const mergedRaw = trimTrailingLineEnding(curr.raw) + next.raw;
	const mergedNode = reparseAsNode(mergedRaw, curr.leadingTrivia);
	parent.children.splice(blockIndex, 2, mergedNode);
	blockIds.splice(blockIndex + 1, 1);
}

// ── Delete ──

/**
 * Remove the node at `blockIndex`.
 * Transfers leading trivia to the next sibling if one exists.
 */
export function deleteNode(parent: NodeParent, blockIds: string[], blockIndex: number): void {
	if (blockIndex < 0 || blockIndex >= parent.children.length) return;

	const deleted = parent.children[blockIndex];

	if (blockIndex + 1 < parent.children.length) {
		parent.children[blockIndex + 1].leadingTrivia =
			deleted.leadingTrivia + parent.children[blockIndex + 1].leadingTrivia;
	}

	parent.children.splice(blockIndex, 1);
	blockIds.splice(blockIndex, 1);
}

// ── Update Content ──

/**
 * Update the raw text of the node at `blockIndex` and re-parse to check
 * for block type changes. Returns whether the kind changed.
 */
export function updateNodeContent(
	parent: NodeParent,
	blockIndex: number,
	newText: string
): { kindChanged: boolean; newKind?: string } {
	const node = parent.children[blockIndex];
	const oldKind = node.kind;

	const reparsed = reparseAsNode(newText, node.leadingTrivia);

	// Copy all fields so leaf↔container transitions propagate children and container structure.
	node.raw = newText;
	node.kind = reparsed.kind;
	node.metadata = reparsed.metadata;
	node.children = reparsed.children;
	node.innerPrefix = reparsed.innerPrefix;
	node.innerSuffix = reparsed.innerSuffix;

	const kindChanged = node.kind !== oldKind;
	return {
		kindChanged,
		newKind: kindChanged ? node.kind : undefined
	};
}

// ── Reparse helper (private) ──

/** Parse a raw string as a single block node. */
function reparseAsNode(raw: string, leadingTrivia: string): CstNode {
	const doc = parse(raw);
	if (doc.children.length > 0) {
		const node = doc.children[0];
		node.leadingTrivia = leadingTrivia;
		ensureEditableContainers(node);
		return node;
	}

	return { kind: 'paragraph', leadingTrivia, raw };
}

// ── Replacement normalization ──

/**
 * Normalize the trivia of a replacement array: the first node inherits the
 * original block's leadingTrivia; subsequent nodes keep their own trivia.
 * Pass-through on empty replacements.
 */
export function normalizeReplacementTrivia(original: CstNode, replacement: CstNode[]): CstNode[] {
	const originalTrivia = original.leadingTrivia ?? '';
	return replacement.map((node, i) => {
		const copy = { ...node };
		copy.leadingTrivia = i === 0 ? originalTrivia : (copy.leadingTrivia ?? '');
		return copy;
	});
}

// ── Editable container backfill ──

/**
 * Ensure every container node in the tree has at least one child block.
 * Without this, container blocks (e.g., a list item with no content after
 * the marker) would have no editing surface for the cursor.
 */
export function ensureEditableContainers(node: CstNode): void {
	if (node.children !== undefined) {
		if (node.children.length === 0) {
			// 0.5.5.1: discovered-descendant mutation, see node-ops.ts header
			node.children.push({ kind: 'paragraph', leadingTrivia: '', raw: '\n' });
		}
		for (const child of node.children) {
			ensureEditableContainers(child);
		}
	}
}
