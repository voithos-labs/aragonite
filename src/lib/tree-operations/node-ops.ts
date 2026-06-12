/**
 * Kind-agnostic CST node mutations: path resolution, split, merge, delete,
 * update, and editable-container scaffolding.
 *
 * Children-array mutation contract:
 *
 * Tree ops that modify a container's top-level children array MUST take the
 * array as an explicit parameter and mutate it, never `node.children` directly.
 * The caller owns the array (typically a spread copy from inside
 * `commitContainerStructural`'s mutate callback) and publishes it after the op
 * returns. Direct `node.children.splice(...)` inside an op collides with the
 * commit primitive's post-mutate publish, which reassigns a pre-mutation copy
 * back — producing the M1 zombie-ListItemBlock class of bug where a stale
 * keyed {#each} entry intercepts typed characters.
 *
 * Scope exception: mutations to other nodes reached by walking the live tree
 * (descendants found during targeting, ancestors during cascade cleanup) remain
 * in-place — but undo snapshots share the live tree, so the caller must put
 * every such node on an unshared spine first (see tree-operations/unshare.ts).
 * Ops that need to mutate discovered descendants structurally should route
 * through that container's scope via `commitMultiScope` (or
 * `commitContainerStructural` for a single scope).
 */

import type { CstNode, Document } from '../core/nodes';
import { parse } from '../core/parser';
import { getContentRange, isProseKind, parseInline } from '../core/inline';
import { trimTrailingLineEnding } from '../core/lines';
import { findMergeTarget } from '../schema/merge-rules';
import { rebuildAncestryRaw } from '../schema/container-raw';
import type { SharingState } from '../undo/sharing';
import { ensureUnsharedChild, ensureUnsharedPath } from './unshare';
import { replacePreservingFirst, type StructuralChange } from './structural-change';

// ── Types ──

export type NodeParent = { children: CstNode[] };

// ── Path resolution ──

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
 * Split the node at `blockIndex` into two at raw `offset` (display-relative,
 * line-ending preserved). First half inherits the original ID.
 *
 * Round-trip caveat at `offset === 0` on a non-empty block: the leading half
 * is `'\n'`, which reparses as an empty paragraph and collapses into trivia
 * on `parse(serialize(...))`. `splitBlock` routes that case to
 * `bumpLeadingTrivia` instead. The list `splitItemAtOffset` path keeps the
 * two-output shape — the empty first half becomes the empty list-item above
 * the new sibling, which the list serializer represents as `- \n` and
 * reparses back to the same shape.
 */
export function splitNode(
	parent: NodeParent,
	blockIndex: number,
	offset: number
): StructuralChange {
	if (blockIndex < 0 || blockIndex >= parent.children.length) return { op: 'noop' };

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
	return replacePreservingFirst(blockIndex, 1, 2);
}

/**
 * Enter-at-block-start companion to `splitNode`. Prepends a blank line into
 * the block's `leadingTrivia` and keeps the node in place — the round-trip
 * shape matches what `parse(serialize(tree))` would produce for a leading
 * blank line.
 */
export function bumpLeadingTrivia(parent: NodeParent, blockIndex: number): StructuralChange {
	if (blockIndex < 0 || blockIndex >= parent.children.length) return { op: 'noop' };
	const node = parent.children[blockIndex];
	const lineEnding = node.raw.endsWith('\r\n') ? '\r\n' : '\n';
	node.leadingTrivia = (node.leadingTrivia ?? '') + lineEnding;
	return replacePreservingFirst(blockIndex, 1, 1);
}

// ── Merge ──

/**
 * Merge the node at `blockIndex` into `blockIndex - 1`. Combined raw is
 * re-parsed; merged block inherits prev's ID. Noop when blockIndex is 0.
 */
export function mergeWithPrevious(parent: NodeParent, blockIndex: number): StructuralChange {
	if (blockIndex <= 0 || blockIndex >= parent.children.length) return { op: 'noop' };

	const prev = parent.children[blockIndex - 1];
	const curr = parent.children[blockIndex];

	const mergedRaw = trimTrailingLineEnding(prev.raw) + curr.raw;
	const mergedNode = reparseAsNode(mergedRaw, prev.leadingTrivia);
	parent.children.splice(blockIndex - 1, 2, mergedNode);
	return replacePreservingFirst(blockIndex - 1, 2, 1);
}

/**
 * `targetPath` is relative to `parent.children[blockIndex - 1]`. Empty means
 * prev itself is the leaf; non-empty walks into prev's container subtree.
 */
export interface MergeIntoPrevResult {
	targetPath: number[];
	joinOffset: number;
	change: StructuralChange;
}

/**
 * Merge `curr` into the deepest prose leaf of `prev`. Unlike `mergeWithPrevious`
 * (which reparses concatenated raw), this writes directly into the deepest leaf
 * via `findMergeTarget` — preserves prev's component identity, IME state, and
 * the leaves' inline caches. Pass `sharing` to unshare everything the merge
 * writes (prev's deep-leaf spine + the deleted node's successor).
 *
 * Returns `null` when no mergeable leaf exists (opaque deepest leaf, empty
 * container, not-mergeable prev kind) so the caller can fall back to move-focus.
 */
export function mergeIntoPrevDeepLeaf(
	parent: NodeParent,
	blockIndex: number,
	sharing?: SharingState
): MergeIntoPrevResult | null {
	if (blockIndex <= 0 || blockIndex >= parent.children.length) return null;

	const mergeTarget = findMergeTarget(parent.children[blockIndex - 1]);
	if (!mergeTarget) return null;

	// The merge writes the deep leaf's raw plus every spine ancestor's rebuilt
	// raw — unshare the whole spine first, then resolve through the owned copies.
	let target = mergeTarget.target;
	if (sharing) {
		const chain = ensureUnsharedPath(parent, [blockIndex - 1, ...mergeTarget.path], sharing);
		target = chain[chain.length - 1];
	}
	const prev = parent.children[blockIndex - 1];
	const curr = parent.children[blockIndex];

	const targetRaw = target.raw ?? '';
	const currRaw = curr.raw ?? '';
	const lineEnding = targetRaw.endsWith('\r\n') ? '\r\n' : '\n';
	const targetText = trimTrailingLineEnding(targetRaw);
	const currText = trimTrailingLineEnding(currRaw);
	const joinOffset = targetText.length;

	target.raw = targetText + currText + lineEnding;
	// The reactive pipeline didn't fire for `target` because the user typed in
	// `curr`; rebuild the inline cache so downstream consumers see post-merge text.
	if (isProseKind(target.kind)) {
		const range = getContentRange(target);
		target.inlineContent = parseInline(target.raw, range.start, range.end);
	}
	if (mergeTarget.path.length > 0) {
		rebuildAncestryRaw(prev, mergeTarget.path);
	}

	const change = deleteNode(parent, blockIndex, sharing);
	return { targetPath: mergeTarget.path, joinOffset, change };
}

/**
 * Merge the node at `blockIndex` with `blockIndex + 1`. Combined raw is
 * re-parsed; merged block inherits the current block's ID. Noop at the tail.
 */
export function mergeWithNext(parent: NodeParent, blockIndex: number): StructuralChange {
	if (blockIndex < 0 || blockIndex >= parent.children.length - 1) return { op: 'noop' };

	const curr = parent.children[blockIndex];
	const next = parent.children[blockIndex + 1];

	const mergedRaw = trimTrailingLineEnding(curr.raw) + next.raw;
	const mergedNode = reparseAsNode(mergedRaw, curr.leadingTrivia);
	parent.children.splice(blockIndex, 2, mergedNode);
	return replacePreservingFirst(blockIndex, 2, 1);
}

// ── Delete ──

/**
 * Remove the node at `blockIndex`, transferring its leading trivia to the next
 * sibling. Pass `sharing` to unshare that successor (the op's only in-place
 * write) before the transfer — the unshare targets the caller-owned
 * `parent.children` entry, and only fires when a successor exists.
 */
export function deleteNode(
	parent: NodeParent,
	blockIndex: number,
	sharing?: SharingState
): StructuralChange {
	if (blockIndex < 0 || blockIndex >= parent.children.length) return { op: 'noop' };

	const deleted = parent.children[blockIndex];

	if (blockIndex + 1 < parent.children.length) {
		const successor = sharing
			? ensureUnsharedChild(parent, blockIndex + 1, sharing)
			: parent.children[blockIndex + 1];
		successor.leadingTrivia = deleted.leadingTrivia + successor.leadingTrivia;
	}

	parent.children.splice(blockIndex, 1);
	return { op: 'delete', at: blockIndex, count: 1 };
}

// ── Update Content ──

/** Update raw and re-parse. Kind changes return replacePreservingFirst (same slot, id kept); otherwise noop. */
export function updateNodeContent(
	parent: NodeParent,
	blockIndex: number,
	newText: string
): StructuralChange {
	const node = parent.children[blockIndex];
	const oldKind = node.kind;

	// tableCell is context-dependent — `parse("foo")` produces a paragraph,
	// not a cell. The row's rebuildRaw owns the surrounding `| ... |` shape,
	// so cells just carry their inner text.
	if (oldKind === 'tableCell') {
		node.raw = newText;
		return { op: 'noop' };
	}

	const reparsed = reparseAsNode(newText, node.leadingTrivia);

	// Copy all fields so leaf↔container transitions propagate children and container structure.
	node.raw = newText;
	node.kind = reparsed.kind;
	node.metadata = reparsed.metadata;
	node.children = reparsed.children;
	node.innerPrefix = reparsed.innerPrefix;
	node.innerSuffix = reparsed.innerSuffix;
	// inlineContent is a cache; downstream dispatch reads it instead of re-parsing,
	// so a paragraph that just gained trailing text would otherwise still look image-only.
	node.inlineContent = isProseKind(node.kind) ? reparsed.inlineContent : undefined;

	return node.kind !== oldKind ? replacePreservingFirst(blockIndex, 1, 1) : { op: 'noop' };
}

// ── Reparse helper (private) ──

function reparseAsNode(raw: string, leadingTrivia: string): CstNode {
	const doc = parse(raw);
	if (doc.children.length > 0) {
		const node = doc.children[0];
		node.leadingTrivia = leadingTrivia;
		ensureEditableContainers(node);
		// `parse` only does block-level work; populate the inline cache so
		// downstream consumers (cursor walkers, click-snap, widget hit-tests)
		// see the post-split inline tree without waiting for the next render.
		if (isProseKind(node.kind)) {
			const range = getContentRange(node);
			node.inlineContent = parseInline(node.raw, range.start, range.end);
		}
		return node;
	}

	return { kind: 'paragraph', leadingTrivia, raw };
}

// ── Replacement normalization ──

/**
 * First node inherits the original block's leadingTrivia; subsequent nodes
 * keep their own. Pass-through on empty replacements.
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
 * Ensure every container has at least one child block, so the cursor always
 * has a target (a list item with no content after the marker, etc.).
 */
export function ensureEditableContainers(node: CstNode): void {
	if (node.children !== undefined) {
		if (node.children.length === 0) {
			// discovered-descendant mutation, see file header
			node.children.push({ kind: 'paragraph', leadingTrivia: '', raw: '\n' });
			// The synthesized paragraph's '\n' already represents the trailing
			// blank that parseBlocks routed into innerPrefix when there were no
			// children. Leaving both in place double-counts the line on rebuild
			// — `- \n` + edit produces `- \n  X\n` instead of `- X\n`.
			node.innerPrefix = '';
		}
		for (const child of node.children) {
			ensureEditableContainers(child);
		}
	}
}
