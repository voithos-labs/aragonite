import type { CstNode, Document } from '../core/nodes';
import type { GrammarView } from '../schema/block-openers';
import { mustHoldChild } from '../schema/block-kind-descriptor';
import type { SharingState } from './sharing';
import { spliceChildrenSettled } from './settle';
import { ensureUnsharedPath } from './unshare';

/**
 * Remove the containers a delete emptied, walking up from `deletedPath`'s parent (a path below
 * `root`) to the first that still holds a child. From the document root it can reach the document,
 * so the commit must hold its scope; `root` itself is never spliced.
 */
export function cascadeCleanupEmptyAncestors(
	root: CstNode | Document,
	deletedPath: number[],
	sharing: SharingState,
	grammar: GrammarView
): void {
	if (!root.children) return;
	// The same array as the root's, so the walk's copies land in the root.
	const top = { children: root.children };
	let currentPath = deletedPath.slice(0, -1);
	while (currentPath.length > 0) {
		const parentPath = currentPath.slice(0, -1);
		const chain = ensureUnsharedPath(top, parentPath, sharing);
		const parent: CstNode | Document = chain[chain.length - 1] ?? root;
		if (!parent.children) break;
		const idx = currentPath[currentPath.length - 1];
		const node = parent.children[idx];
		if (!node || !mustHoldChild(node.kind) || (node.children?.length ?? 0) > 0) break;
		spliceChildrenSettled(parent, idx, 1, [], grammar, sharing);
		currentPath = parentPath;
	}
}
