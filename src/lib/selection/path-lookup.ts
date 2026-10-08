/** Walks the document tree by path, and reads block paths off the DOM. */

import type { CstNode, Document } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { caretChildCount, isCollapsedContainer } from '../schema/reserved-chrome';
import { TABLE_CELL_SELECTOR } from '../caret/block-content-selector';

/** Block immediately after `path` in doc order (children before siblings), else null. */
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

/** Block immediately before `path` in doc order (deepest last descendant first), else null. */
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

/** Descend `path` to its first leaf, or null when `path` doesn't resolve to a node. */
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

/** Descend `path` to its last leaf, or null when `path` doesn't resolve to a node. */
export function lastLeafAtOrBefore(doc: Document, path: number[]): number[] | null {
	let cur: number[] | null = path;
	while (cur) {
		// Annotated because overload resolution and the `cur` reassignment below otherwise make
		// TypeScript's inference cycle.
		const node: CstNode | Document | null = nodeAt(doc, cur);
		if (!node) return null;
		if (!('children' in node) || !node.children || node.children.length === 0) return cur;
		cur = [...cur, node.children.length - 1];
	}
	return null;
}

// ── Caret-reachable order ──────────────────────────────────────────────────
// The same order as above, but a collapsed container is only its title row, since a caret never
// sits in its hidden body; select-all keeps the functions above, as its range covers that body.

/** The first leaf a caret can reach at or inside `path`, or null when `path` does not resolve. */
export function firstCaretLeaf(doc: DocumentView, path: readonly number[]): number[] | null {
	return descendToCaretLeaf(doc, path, () => 0);
}

/** The last leaf a caret can reach at or inside `path`, or null when `path` does not resolve. */
export function lastCaretLeaf(doc: DocumentView, path: readonly number[]): number[] | null {
	return descendToCaretLeaf(doc, path, (node) => reachableChildCount(node) - 1);
}

/** The first caret leaf after `path` in document order, descending into it first when it has
 *  children, as {@link nextPath} does. */
export function nextCaretPath(doc: DocumentView, path: readonly number[]): number[] | null {
	const node = nodeAt(doc, [...path]);
	if (!node || path.length === 0) return null;
	if (reachableChildCount(node) > 0) return firstCaretLeafFrom(doc, [...path, 0]);
	return firstCaretLeafFrom(doc, [...path.slice(0, -1), path[path.length - 1] + 1]);
}

/** The last caret leaf before `path`'s subtree in document order; an ancestor of `path` is never
 *  the answer. `path` need not resolve, so the position a removed block left reads the same. */
export function previousCaretPath(doc: DocumentView, path: readonly number[]): number[] | null {
	const hiding = collapsedContainerHiding(doc, path);
	if (hiding) return lastCaretLeaf(doc, [...hiding, 0]);
	let slot = [...path];
	while (slot.length > 0) {
		const parentPath = slot.slice(0, -1);
		const parent = nodeAt(doc, parentPath);
		if (!parent) return null;
		const before = Math.min(slot[slot.length - 1], reachableChildCount(parent)) - 1;
		if (before >= 0) return lastCaretLeaf(doc, [...parentPath, before]);
		slot = parentPath;
	}
	return null;
}

/** The first caret leaf at `slot` or after it, where `slot` may sit one past the end of its list
 *  (the place a removed last child left). */
export function firstCaretLeafFrom(doc: DocumentView, slot: readonly number[]): number[] | null {
	const hiding = collapsedContainerHiding(doc, slot);
	let at = hiding ? [...hiding.slice(0, -1), hiding[hiding.length - 1] + 1] : [...slot];
	while (at.length > 0) {
		const parentPath = at.slice(0, -1);
		const parent = nodeAt(doc, parentPath);
		if (!parent) return null;
		if (at[at.length - 1] < reachableChildCount(parent)) return firstCaretLeaf(doc, at);
		if (parentPath.length === 0) return null;
		at = [...parentPath.slice(0, -1), parentPath[parentPath.length - 1] + 1];
	}
	return null;
}

/** The outermost collapsed container whose hidden body `path` runs through, or null. */
export function collapsedContainerHiding(
	doc: DocumentView,
	path: readonly number[]
): number[] | null {
	for (let depth = 1; depth < path.length; depth++) {
		if (path[depth] < 1) continue;
		const container = nodeAt(doc, path.slice(0, depth));
		if (container && isBlockNode(container) && isCollapsedContainer(container)) {
			return path.slice(0, depth);
		}
	}
	return null;
}

function descendToCaretLeaf(
	doc: DocumentView,
	path: readonly number[],
	pick: (node: NodeView | DocumentView) => number
): number[] | null {
	const leaf = [...path];
	let node = nodeAt(doc, leaf);
	if (!node) return null;
	while (reachableChildCount(node) > 0) {
		const index = pick(node);
		leaf.push(index);
		node = node.children![index];
	}
	return leaf.length > 0 ? leaf : null;
}

// The document root is never collapsed, and has no descriptor to ask.
function reachableChildCount(node: NodeView | DocumentView): number {
	return isBlockNode(node) ? caretChildCount(node) : node.children.length;
}

/** The path an element's own `data-block-path` carries, read in one place: a plugin may own the
 *  attribute with content of its own, so anything but a list of numbers reads as null. */
export function readBlockPath(el: Element | null): number[] | null {
	const attr = el?.getAttribute('data-block-path');
	if (!attr) return null;
	try {
		const parsed: unknown = JSON.parse(attr);
		return Array.isArray(parsed) && parsed.every((n) => typeof n === 'number') ? parsed : null;
	} catch {
		return null;
	}
}

/** Walk up from `el` to the nearest ancestor carrying `data-block-path`. */
export function findBlockPathForElement(el: Element | null): number[] | null {
	let cur: Element | null = el;
	while (cur) {
		if (cur.getAttribute('data-block-path')) return readBlockPath(cur);
		cur = cur.parentElement;
	}
	return null;
}

/** The `[...tablePath, row, col]` path of an element in a table cell: only block hosts carry a
 *  path, so a DOM-read endpoint in a cell must come through here or it reads as the table's. */
export function findCellPathForElement(el: Element | null): number[] | null {
	const cellEl = el?.closest(TABLE_CELL_SELECTOR) ?? null;
	if (!cellEl) return null;
	const rowEl = cellEl.closest('[data-table-row-idx]');
	if (!rowEl) return null;
	const tablePath = findBlockPathForElement(rowEl);
	if (!tablePath) return null;

	const rowIdx = Number(rowEl.getAttribute('data-table-row-idx'));
	if (!Number.isInteger(rowIdx)) return null;
	const colIdx = Array.from(rowEl.querySelectorAll(`:scope > ${TABLE_CELL_SELECTOR}`)).indexOf(
		cellEl
	);
	if (colIdx < 0) return null;

	return [...tablePath, rowIdx, colIdx];
}

/** The editable element `el` sits in: the enclosing cell where there is one, else the enclosing
 *  block, plus which of the two answered, so a caller that treats cells differently reads the
 *  flag rather than re-deriving it. */
export interface EditingSurface {
	path: number[];
	inCell: boolean;
}

/** The cell-then-block lookup {@link findCellPathForElement} requires, in one place. */
export function findSurfaceForElement(el: Element | null): EditingSurface | null {
	const cellPath = findCellPathForElement(el);
	if (cellPath) return { path: cellPath, inCell: true };
	const blockPath = findBlockPathForElement(el);
	return blockPath ? { path: blockPath, inCell: false } : null;
}

/** {@link findSurfaceForElement} for a caller that needs only the path. */
export function findSurfacePathForElement(el: Element | null): number[] | null {
	return findSurfaceForElement(el)?.path ?? null;
}
