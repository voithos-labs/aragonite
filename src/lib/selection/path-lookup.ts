/**
 * Document-tree path navigation. Pure functions over a Document + path.
 * Used by keyboard dispatch (find the next/previous block), pointer drag
 * (block hit testing), and undo restoration (resolve a path back to a node).
 */

import type { CstNode, Document } from '../core/nodes';
export { nodeAt } from '../tree-operations/generic';
import { nodeAt } from '../tree-operations/generic';

/**
 * Return the path of the block immediately after `path` in document order,
 * or null if `path` is the last block. Walks into container children
 * before walking across siblings.
 */
export function nextPath(doc: Document, path: number[]): number[] | null {
	const node = nodeAt(doc, path);
	if (node && 'children' in node && node.children && node.children.length > 0) {
		return [...path, 0];
	}
	let p = path.slice();
	while (p.length > 0) {
		const parentPath = p.slice(0, -1);
		const parent = nodeAt(doc, parentPath);
		if (!parent || !parent.children) return null;
		const idx = p[p.length - 1];
		if (idx + 1 < parent.children.length) {
			return [...parentPath, idx + 1];
		}
		p = parentPath;
	}
	return null;
}

/**
 * Return the path of the block immediately before `path` in document order,
 * or null if `path` is the first block. Walks into the previous sibling's
 * deepest last descendant before walking across siblings.
 */
export function previousPath(doc: Document, path: number[]): number[] | null {
	if (path.length === 0) return null;
	const parentPath = path.slice(0, -1);
	const parent = nodeAt(doc, parentPath);
	if (!parent || !parent.children) return null;
	const idx = path[path.length - 1];
	if (idx > 0) {
		let cur: number[] = [...parentPath, idx - 1];
		while (true) {
			const node = nodeAt(doc, cur);
			if (!node || !('children' in node) || !node.children || node.children.length === 0) {
				return cur;
			}
			cur = [...cur, node.children.length - 1];
		}
	}
	if (parentPath.length === 0) return null;
	return parentPath;
}

/** First block in document order, or null if the document is empty. */
export function firstPath(doc: Document): number[] | null {
	if (!doc.children || doc.children.length === 0) return null;
	const path: number[] = [0];
	let node: CstNode | Document = doc.children[0];
	while ('children' in node && node.children && node.children.length > 0) {
		path.push(0);
		node = node.children[0];
	}
	return path;
}

/** Last block in document order (deepest last descendant), or null if empty. */
export function lastPath(doc: Document): number[] | null {
	if (!doc.children || doc.children.length === 0) return null;
	const path: number[] = [doc.children.length - 1];
	let node: CstNode | Document = doc.children[doc.children.length - 1];
	while ('children' in node && node.children && node.children.length > 0) {
		const lastIdx: number = node.children.length - 1;
		path.push(lastIdx);
		node = node.children[lastIdx];
	}
	return path;
}

/**
 * Walk up from `el` until we find an ancestor with `data-block-path`.
 * Returns the parsed path, or null if none found.
 */
export function findBlockPathForElement(el: Element | null): number[] | null {
	let cur: Element | null = el;
	while (cur) {
		const attr = cur.getAttribute?.('data-block-path');
		if (attr) {
			try {
				return JSON.parse(attr) as number[];
			} catch {
				return null;
			}
		}
		cur = cur.parentElement;
	}
	return null;
}
