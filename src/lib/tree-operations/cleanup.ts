import type { CstNode, Document } from '../core/nodes';
import type { SharingState } from './sharing';
import { spliceChildren } from './children';
import { ensureUnsharedPath } from './unshare';

/**
 * Walk from `deletedPath`'s parent up toward the document root, removing
 * any container whose last child was the subject being cleaned up. Stops
 * when the walk reaches `lcaPath` — the lowest common ancestor of the
 * original `start.path` and `end.path` of the range operation — because
 * containers at or above the LCA still have startBlock (or its merged
 * replacement) in their descendant tree and can't legitimately be empty.
 *
 * `lcaPath = []` means "walk all the way to the document root if needed".
 *
 * Takes `sharing` because it splices at arbitrary depth and so owns its spine
 * (unshare.ts header): each level is unshared before its child is removed, or the
 * splice lands on a node an undo entry still references.
 */
export function cascadeCleanupEmptyAncestors(
	doc: Document,
	deletedPath: number[],
	lcaPath: number[],
	sharing: SharingState
): void {
	let currentPath = deletedPath.slice(0, -1);
	while (currentPath.length > lcaPath.length) {
		const parentPath = currentPath.slice(0, -1);
		const chain = ensureUnsharedPath(doc, parentPath, sharing);
		const parent: CstNode | Document = chain[chain.length - 1] ?? doc;
		if (!parent.children) break;
		const idx = currentPath[currentPath.length - 1];
		const node = parent.children[idx];
		if (!node || !node.children || node.children.length > 0) break;
		spliceChildren(parent as CstNode, idx, 1);
		currentPath = parentPath;
	}
}
