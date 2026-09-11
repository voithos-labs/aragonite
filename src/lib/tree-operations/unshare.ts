/**
 * Copy-path-on-write for structural-sharing undo: unshare the root→target spine before
 * any in-place write — undo entries still reference shared nodes. Copies are SHALLOW, so
 * unshare deeper wherever you write. Write-then-re-read: after assigning a copy into the
 * live tree, re-read it through the tree — the `$state` proxy wrapper is canonical, not
 * the copy you held. Also the one sanctioned view→mutable door (`core/node-views.ts`).
 */
import type { CstNode } from '../core/nodes';
import type { NodeParentView, NodeView } from '../core/node-views';
import type { SharingState } from './sharing';
import type { NodeParent } from './node-primitives';
import { assertInvariant } from '../assert';
import { checkCloneSafeMetadata } from '../invariants/node-shape';
import { rebuildContainerRawIfContainer } from '../schema/container-raw';
import type { ChildRawChange } from '../schema/child-spans';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { cloneMetadata } from './clone';

function copyNode(node: NodeView, sharing: SharingState): CstNode {
	const copy = { ...node } as CstNode;
	if (node.children) copy.children = [...node.children] as CstNode[];
	if (node.childIds) copy.childIds = [...node.childIds];
	// A splice writes spans in place, so sharing the array would rewrite the snapshot's own.
	if (node.childSpans) copy.childSpans = node.childSpans.slice();
	if (node.metadata) {
		assertInvariant('clone-safe-metadata', () => checkCloneSafeMetadata(node));
		copy.metadata = cloneMetadata(node.metadata);
	}
	sharing.stamp(copy);
	return copy;
}

/**
 * The copy-on-write spine walk, returning the owned chain outermost-first. `assertInRange`
 * fires G1.22 for the strict `ensureUnsharedPath` caller and stays silent for tolerant rebuild
 * passes, which legitimately hand short paths; the walk stops at the first gap either way.
 */
export function walkUnsharing(
	root: NodeParentView,
	path: number[],
	sharing: SharingState,
	assertInRange: boolean
): CstNode[] {
	const chain: CstNode[] = [];
	// Root is the live document or a ceremony-owned array — writable by contract (file header).
	let parentChildren = root.children as CstNode[];
	for (const index of path) {
		let node = parentChildren[index];
		if (assertInRange) {
			assertInvariant('unshare-path-in-range', () =>
				node ? null : { code: 'unshare-path', message: `path index ${index} out of range` }
			);
		}
		if (!node) break;
		if (sharing.isShared(node)) {
			parentChildren[index] = copyNode(node, sharing);
			// Write-then-re-read (file header).
			node = parentChildren[index];
		}
		chain.push(node);
		parentChildren = node.children ?? [];
	}
	return chain;
}

/**
 * Unshare every node along `path` from `root`; returns the chain outermost-first. The caller
 * owns `root.children` (live document, or a commit ceremony's array copy).
 */
export function ensureUnsharedPath(
	root: NodeParentView,
	path: number[],
	sharing: SharingState
): CstNode[] {
	return walkUnsharing(root, path, sharing, true);
}

/** Unshare one direct child of an already-unshared parent, or of a caller-owned `{ children }`. */
export function ensureUnsharedChild(
	parent: CstNode | NodeParent,
	index: number,
	sharing: SharingState
): CstNode {
	const child = parent.children![index];
	// G1.22: an index off the end is a caller bug, failed here rather than epoch-dependently
	// inside `isShared`.
	assertInvariant('unshare-path-in-range', () =>
		child ? null : { code: 'unshare-path', message: `child index ${index} out of range` }
	);
	if (!child || !sharing.isShared(child)) return child;
	parent.children![index] = copyNode(child, sharing);
	// Write-then-re-read (file header).
	return parent.children![index];
}

/**
 * Standalone copy for a node being MOVED out of a parent the snapshot keeps: the caller attaches
 * the copy, the original stays put. An unshared input passes through as live-tree-owned.
 */
export function ensureUnsharedNode(node: NodeView, sharing: SharingState): CstNode {
	return sharing.isShared(node) ? copyNode(node, sharing) : (node as CstNode);
}

/** Unshare every direct child of an owned parent (e.g. table rows before a whole-table rebuild). */
export function ensureUnsharedChildren(parent: CstNode, sharing: SharingState): void {
	const count = parent.children?.length ?? 0;
	for (let i = 0; i < count; i++) ensureUnsharedChild(parent, i, sharing);
}

/** Deep-unshare an owned node's subtree, for small bounded subtrees written at arbitrary depth. */
export function ensureUnsharedSubtree(node: CstNode, sharing: SharingState): void {
	const count = node.children?.length ?? 0;
	for (let i = 0; i < count; i++) {
		ensureUnsharedSubtree(ensureUnsharedChild(node, i, sharing), sharing);
	}
}

// ── Sharing-aware raw rebuild ───────────────────────────────────────────────

/**
 * Rebuild one owned container's raw. A grid rebuild rewrites its children's raw, so a grid's
 * children are unshared first, keyed off `containerContract` rather than a `table` kind test.
 */
export function rebuildOwnedContainer(
	node: CstNode,
	sharing: SharingState,
	changed?: ChildRawChange
): void {
	if (getBlockKindDescriptor(node.kind).containerContract === 'grid') {
		ensureUnsharedChildren(node, sharing);
	}
	rebuildContainerRawIfContainer(node, changed);
}
