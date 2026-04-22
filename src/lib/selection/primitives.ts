/**
 * Pure primitives for cross-block selection: types, path math,
 * document-order walking, and overlay classification. No DOM, no state.
 */

import type { CstNode, Document } from '../core/nodes';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * A single selection endpoint: path of child indices plus character offset
 * into the leaf's `raw`. Empty path is the document root.
 */
export interface SelectionPoint {
	path: number[];
	offset: number;
}

/**
 * Anchor/focus pair. Same path + same offset is collapsed; same path +
 * different offsets is a single-block range (handled natively; runtime
 * SelectionState stays null); different paths is cross-block.
 */
export interface EditorSelection {
	anchor: SelectionPoint;
	focus: SelectionPoint;
}

/**
 * Pointerdown anchor of a potential cross-block drag before it has escaped
 * the original block. Null when no drag is active.
 */
export type SelectionDragStart = SelectionPoint | null;

// ── Path comparison ────────────────────────────────────────────────────────

/**
 * Compare two paths in document order. Ancestor-before-descendant:
 * `[2]` comes before `[2, 0]` (container opens before children).
 */
export function comparePaths(a: number[], b: number[]): number {
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		if (a[i] < b[i]) return -1;
		if (a[i] > b[i]) return 1;
	}
	if (a.length < b.length) return -1;
	if (a.length > b.length) return 1;
	return 0;
}

// ── Point equality ─────────────────────────────────────────────────────────

/** Value equality on path + offset. */
export function pointsEqual(a: SelectionPoint, b: SelectionPoint): boolean {
	if (a.offset !== b.offset) return false;
	if (a.path.length !== b.path.length) return false;
	for (let i = 0; i < a.path.length; i++) {
		if (a.path[i] !== b.path[i]) return false;
	}
	return true;
}

// ── Normalization ──────────────────────────────────────────────────────────

/**
 * Normalize to {start, end} where start <= end in document order
 * (by path, then by offset when paths match).
 */
export function normalize(selection: EditorSelection): {
	start: SelectionPoint;
	end: SelectionPoint;
} {
	const { anchor, focus } = selection;
	const cmp = comparePaths(anchor.path, focus.path);
	if (cmp < 0) return { start: anchor, end: focus };
	if (cmp > 0) return { start: focus, end: anchor };
	if (anchor.offset <= focus.offset) return { start: anchor, end: focus };
	return { start: focus, end: anchor };
}

// ── Between predicate ──────────────────────────────────────────────────────

/**
 * True if `path` is strictly between `start` and `end` in document order
 * (exclusive of both endpoints).
 */
export function isPathBetween(path: number[], start: number[], end: number[]): boolean {
	return comparePaths(path, start) > 0 && comparePaths(path, end) < 0;
}

// ── Range walk ─────────────────────────────────────────────────────────────

/**
 * Every block path strictly between `start` and `end` in document order
 * (exclusive of both endpoints). Walks every nesting level.
 */
export function walkBetween(doc: Document, start: number[], end: number[]): number[][] {
	if (comparePaths(start, end) >= 0) return [];

	const result: number[][] = [];

	function visit(node: CstNode | Document, path: number[]): void {
		if (isPathBetween(path, start, end)) {
			result.push([...path]);
		}
		if (!node.children) return;
		for (let i = 0; i < node.children.length; i++) {
			const childPath = [...path, i];
			// Skip subtrees that are entirely before start or after end.
			const firstDescendant = [...childPath];
			const lastDescendant = [...childPath, ...Array(8).fill(Number.MAX_SAFE_INTEGER)];
			if (comparePaths(lastDescendant, start) <= 0) continue;
			if (comparePaths(firstDescendant, end) >= 0) break;
			visit(node.children[i], childPath);
		}
	}

	visit(doc, []);
	return result;
}

// ── Overlay classification ─────────────────────────────────────────────────

export type BlockSelectionClass = 'outside' | 'start' | 'middle' | 'end' | 'single-block';

/**
 * Classify a block's position relative to a selection for overlay rendering.
 * 'single-block' is returned so callers can delegate to the browser instead
 * of painting an overlay.
 */
export function classifyBlockForSelection(
	path: number[],
	selection: EditorSelection
): BlockSelectionClass {
	const { start, end } = normalize(selection);
	if (comparePaths(start.path, end.path) === 0) {
		return comparePaths(path, start.path) === 0 ? 'single-block' : 'outside';
	}
	if (comparePaths(path, start.path) === 0) return 'start';
	if (comparePaths(path, end.path) === 0) return 'end';
	if (isPathBetween(path, start.path, end.path)) return 'middle';
	return 'outside';
}
