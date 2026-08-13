import type { CstNode, Document } from '../core/nodes';
import type { SharingState } from './sharing';
import { spliceChildrenSettled } from './node-ops';
import { ensureUnsharedPath } from './unshare';

/**
 * Walk up from `deletedPath`'s parent, removing containers emptied by the cleanup. Stops
 * at `lcaPath` (the range operation's lowest common ancestor, `[]` for the document root)
 * because containers at or above it still hold the start block and cannot legitimately be
 * empty. Owns its spine — each level is unshared before its child is removed, or the
 * splice lands on a node an undo entry still references (`unshare.ts` header).
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
		spliceChildrenSettled(parent, idx, 1, [], sharing);
		currentPath = parentPath;
	}
}
