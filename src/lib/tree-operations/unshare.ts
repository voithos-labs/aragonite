/**
 * Copy before write: undo entries reference the live tree's nodes, so every node from the root
 * down to the target is copied before an in-place write, and the functions here are the only way
 * from a read-only view to a writable node. Copies are shallow, so copy deeper wherever you write,
 * and re-read a copy through the tree after assigning it, since the `$state` proxy is the node.
 */
import type { CstNode } from '../core/nodes';
import type { NodeParentView, NodeView } from '../core/node-views';
import type { SharingState } from './sharing';
import type { NodeParent } from './node-primitives';
import { assertInvariant } from '../assert';
import { checkCloneSafeMetadata } from '../invariants/node-shape';
import { rebuildContainerRawIfContainer } from '../schema/container-raw';
import type { ChildRawChange, StripRebuild } from '../schema/child-spans';
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
 * The copy-on-write walk down `path`, outermost first. `assertInRange` fails an index off the end
 * (G1.22); rebuild passes turn it off because they hand in short paths on purpose.
 */
export function walkUnsharing(
	root: NodeParentView,
	path: number[],
	sharing: SharingState,
	assertInRange: boolean
): CstNode[] {
	const chain: CstNode[] = [];
	// The root is the live document or an array the commit sequence owns, writable by contract
	// (file header).
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
			// Write, then re-read through the tree (file header).
			node = parentChildren[index];
		}
		chain.push(node);
		parentChildren = node.children ?? [];
	}
	return chain;
}

/**
 * Unshare every node along `path` from `root`; returns the chain outermost-first. The caller
 * owns `root.children` (the live document, or a commit sequence's array copy).
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
	// An index off the end is a caller bug (G1.22), failed here rather than inside `isShared`,
	// where it would depend on the generation counter.
	assertInvariant('unshare-path-in-range', () =>
		child ? null : { code: 'unshare-path', message: `child index ${index} out of range` }
	);
	if (!child || !sharing.isShared(child)) return child;
	parent.children![index] = copyNode(child, sharing);
	// Write, then re-read through the tree (file header).
	return parent.children![index];
}

/**
 * A standalone copy of a node moving out of a parent the snapshot keeps, for the caller to attach;
 * a node no snapshot shares passes through as it is.
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

/** Rebuild one owned container's raw. A table's rebuild writes a row only when its cells or its
 *  place changed, which only an edit that already copied the row causes; the undo digest checks. */
export function rebuildOwnedContainer(
	node: CstNode,
	changed?: ChildRawChange
): StripRebuild | undefined {
	return rebuildContainerRawIfContainer(node, changed);
}
