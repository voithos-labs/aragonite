/**
 * Copy-path-on-write for structural-sharing undo. Before any in-place write,
 * the spine from the document root to the write target must be unshared —
 * shared nodes are still referenced by undo/redo entries, and writing through
 * them corrupts history. Copies are SHALLOW: children/childIds arrays are
 * fresh, but child refs still point at shared subtrees (unshare deeper only
 * where you write). Callers live in editor-actions/ and selection/ — the
 * layers that know paths; tree-operations stays path-free internally.
 */
import type { CstNode, Document } from '../core/nodes';
import type { SharingState } from '../undo/sharing';
import { assertInvariant } from '../invariants/assert';
import { checkCloneSafeMetadata } from '../invariants/node-shape';
import { cloneMetadata } from './clone';

function copyNode(node: CstNode, sharing: SharingState): CstNode {
	const copy: CstNode = { ...node };
	if (node.children) copy.children = [...node.children];
	if (node.childIds) copy.childIds = [...node.childIds];
	if (node.metadata) {
		assertInvariant('clone-safe-metadata', () => checkCloneSafeMetadata(node));
		copy.metadata = cloneMetadata(node.metadata);
	}
	if (node.inlineContent) copy.inlineContent = [...node.inlineContent];
	sharing.stamp(copy);
	return copy;
}

/**
 * Unshare every node along `path` (child indices from doc root), splicing
 * copies into their (already-unshared) parents. Returns the node chain,
 * outermost first. doc.children itself is owned by the commit ceremony
 * (copied per commit), so the array splice here is safe.
 */
export function ensureUnsharedPath(
	doc: Document,
	path: number[],
	sharing: SharingState
): CstNode[] {
	const chain: CstNode[] = [];
	let parentChildren = doc.children;
	for (const index of path) {
		const node = parentChildren[index];
		assertInvariant('unshare-path-in-range', () =>
			node ? null : { code: 'unshare-path', message: `path index ${index} out of range` }
		);
		if (!node) return chain;
		const owned = sharing.isShared(node) ? copyNode(node, sharing) : node;
		parentChildren[index] = owned;
		chain.push(owned);
		parentChildren = owned.children ?? [];
	}
	return chain;
}

/** Unshare one direct child of an already-unshared parent (e.g. renumber targets). */
export function ensureUnsharedChild(
	parent: CstNode,
	index: number,
	sharing: SharingState
): CstNode {
	const child = parent.children![index];
	if (!sharing.isShared(child)) return child;
	const owned = copyNode(child, sharing);
	parent.children![index] = owned;
	return owned;
}
