/**
 * Cascade cleanup of empty container ancestors after a block deletion.
 * Used by range-delete and any future operation that removes blocks.
 */

import type { CstNode, Document } from '../core/nodes';

/**
 * Walk from `deletedPath`'s parent up toward the document root, removing
 * any container whose last child was the subject being cleaned up. Stops
 * when the walk reaches `lcaPath` — the lowest common ancestor of the
 * original `start.path` and `end.path` of the range operation — because
 * containers at or above the LCA still have startBlock (or its merged
 * replacement) in their descendant tree and can't legitimately be empty.
 *
 * `lcaPath = []` means "walk all the way to the document root if needed".
 */
export function cascadeCleanupEmptyAncestors(
	doc: Document,
	deletedPath: number[],
	lcaPath: number[]
): void {
	// Walk from the deleted block's parent upward. Containers at or above the
	// LCA still contain startBlock (or its merged replacement), so the walk
	// only processes paths strictly deeper than lcaPath.
	let currentPath = deletedPath.slice(0, -1);
	while (currentPath.length > lcaPath.length) {
		const node = nodeAt(doc, currentPath);
		if (!node || !('children' in node) || !node.children) break;
		if (node.children.length > 0) break;
		const parentPath = currentPath.slice(0, -1);
		const parent = nodeAt(doc, parentPath);
		if (!parent || !('children' in parent) || !parent.children) break;
		const idx = currentPath[currentPath.length - 1];
		parent.children.splice(idx, 1);
		currentPath = parentPath;
	}
}

function nodeAt(doc: Document, path: number[]): CstNode | Document | null {
	let cur: CstNode | Document = doc;
	for (const idx of path) {
		if (!cur.children || idx >= cur.children.length) return null;
		cur = cur.children[idx];
	}
	return cur;
}
