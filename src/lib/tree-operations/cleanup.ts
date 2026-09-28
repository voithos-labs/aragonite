import type { CstNode, Document } from '../core/nodes';
import type { GrammarView } from '../schema/block-openers';
import { mustHoldChild } from '../schema/block-kind-descriptor';
import type { SharingState } from './sharing';
import { spliceChildrenSettled } from './settle';
import { ensureUnsharedPath } from './unshare';

/**
 * Remove the containers a delete emptied, walking up from `deletedPath`'s parent to `lcaPath`
 * (the range's lowest common ancestor), whose containers still hold the start block.
 */
export function cascadeCleanupEmptyAncestors(
	doc: Document,
	deletedPath: number[],
	lcaPath: number[],
	sharing: SharingState,
	grammar: GrammarView
): void {
	let currentPath = deletedPath.slice(0, -1);
	while (currentPath.length > lcaPath.length) {
		const parentPath = currentPath.slice(0, -1);
		const chain = ensureUnsharedPath(doc, parentPath, sharing);
		const parent: CstNode | Document = chain[chain.length - 1] ?? doc;
		if (!parent.children) break;
		const idx = currentPath[currentPath.length - 1];
		const node = parent.children[idx];
		if (!node || !mustHoldChild(node.kind) || (node.children?.length ?? 0) > 0) break;
		spliceChildrenSettled(parent, idx, 1, [], grammar, sharing);
		currentPath = parentPath;
	}
}
