/**
 * Document-tree path navigation. Pure functions over a Document + path.
 */

import type { CstNode, Document } from '../core/nodes';
import { nodeAt } from '../tree-operations/node-ops';

/**
 * Block immediately after `path` in document order, or null if `path` is
 * last. Walks into children before siblings.
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
 * Block immediately before `path` in document order, or null if `path` is
 * first. Walks into the previous sibling's deepest last descendant first.
 */
export function previousPath(doc: Document, path: number[]): number[] | null {
	if (path.length === 0) return null;
	const parentPath = path.slice(0, -1);
	const parent = nodeAt(doc, parentPath);
	if (!parent || !parent.children) return null;
	const idx = path[path.length - 1];
	if (idx > 0) {
		return lastLeafAtOrBefore(doc, [...parentPath, idx - 1]);
	}
	if (parentPath.length === 0) return null;
	return parentPath;
}

/** First block in document order, or null if the document is empty. */
export function firstPath(doc: Document): number[] | null {
	if (!doc.children || doc.children.length === 0) return null;
	return firstLeafAtOrAfter(doc, [0]);
}

/** Last block in document order (deepest last descendant), or null if empty. */
export function lastPath(doc: Document): number[] | null {
	if (!doc.children || doc.children.length === 0) return null;
	return lastLeafAtOrBefore(doc, [doc.children.length - 1]);
}

/**
 * Descend `path` to its first leaf — first child at each level — or null when
 * `path` doesn't resolve to a node.
 */
export function firstLeafAtOrAfter(doc: Document, path: number[]): number[] | null {
	let cur: number[] | null = path;
	while (cur) {
		const node = nodeAt(doc, cur);
		if (!node) return null;
		if (!('children' in node) || !node.children || node.children.length === 0) return cur;
		cur = [...cur, 0];
	}
	return null;
}

/**
 * Descend `path` to its last leaf — last child at each level — or null when
 * `path` doesn't resolve to a node.
 */
export function lastLeafAtOrBefore(doc: Document, path: number[]): number[] | null {
	let cur: number[] | null = path;
	while (cur) {
		// Annotated: overload resolution + the `cur` reassignment below otherwise cycle inference.
		const node: CstNode | Document | null = nodeAt(doc, cur);
		if (!node) return null;
		if (!('children' in node) || !node.children || node.children.length === 0) return cur;
		cur = [...cur, node.children.length - 1];
	}
	return null;
}

/**
 * Walk up from `el` to the nearest ancestor carrying `data-block-path`.
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
