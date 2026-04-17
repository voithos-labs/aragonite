/**
 * Pure primitives for the cross-block selection layer: types,
 * path math, document-order walking, and overlay classification.
 * No DOM, no state — every value is a plain object and every function
 * is pure. Consumed by selection-state, range-delete, native-bridge,
 * SelectionOverlay, and the clipboard helpers.
 */

import type { CstNode, Document } from '../core/nodes';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * A single endpoint of a selection. Addresses any leaf block in the document
 * tree via a path of child indices, plus a character offset into the leaf's
 * `raw` field.
 *
 * path: [2, 0, 1] means doc.children[2].children[0].children[1].
 * An empty path ([]) is the document root.
 */
export interface SelectionPoint {
	path: number[];
	offset: number;
}

/**
 * Anchor/focus pair. A collapsed selection has `anchor === focus` by value.
 * `anchor.path === focus.path` with different offsets is a single-block range
 * (native browser handles it; runtime SelectionState stays null). Different
 * paths is a cross-block range.
 */
export interface EditorSelection {
	anchor: SelectionPoint;
	focus: SelectionPoint;
}

/**
 * Shadow value captured at pointerdown — the anchor of a potential cross-block
 * drag before it has escaped the original block. null when no drag is active.
 */
export type SelectionDragStart = SelectionPoint | null;

// ── Path comparison ────────────────────────────────────────────────────────

/**
 * Compare two paths in document order.
 * Returns -1 if `a` comes before `b`, 1 if `a` comes after, 0 if equal.
 *
 * Ancestor-before-descendant: `[2]` comes before `[2, 0]` because in a
 * document walk, the container opens before its children.
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

/** True if both points refer to the same path and offset (value equality, not reference). */
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
 * Normalize an EditorSelection into {start, end} where start <= end in
 * document order. A same-path selection with focus before anchor also gets
 * normalized by offset.
 */
export function normalize(
	selection: EditorSelection
): { start: SelectionPoint; end: SelectionPoint } {
	const { anchor, focus } = selection;
	const cmp = comparePaths(anchor.path, focus.path);
	if (cmp < 0) return { start: anchor, end: focus };
	if (cmp > 0) return { start: focus, end: anchor };
	// Same path — compare by offset.
	if (anchor.offset <= focus.offset) return { start: anchor, end: focus };
	return { start: focus, end: anchor };
}

// ── Between predicate ──────────────────────────────────────────────────────

/**
 * True if `path` is strictly between `start` and `end` in document order
 * (exclusive of both endpoints). Used by overlay classification to decide
 * whether a block is a "middle block."
 */
export function isPathBetween(path: number[], start: number[], end: number[]): boolean {
	return comparePaths(path, start) > 0 && comparePaths(path, end) < 0;
}

// ── Range walk ─────────────────────────────────────────────────────────────

/**
 * Return every block path strictly between `start` and `end` in document order.
 * Exclusive of both endpoints. Walks every nesting level.
 *
 * Used by range-delete to collect deletion targets, and by cross-block copy
 * to collect middle blocks whose text contributes to the clipboard payload.
 */
export function walkBetween(
	doc: Document,
	start: number[],
	end: number[]
): number[][] {
	if (comparePaths(start, end) >= 0) return [];

	const result: number[][] = [];

	function visit(node: CstNode | Document, path: number[]): void {
		if (isPathBetween(path, start, end)) {
			result.push([...path]);
		}
		if (!node.children) return;
		for (let i = 0; i < node.children.length; i++) {
			const childPath = [...path, i];
			// Short-circuit: if the entire subtree is before start or after end,
			// we can skip it. This is O(path length) per skip — cheap.
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
 * The single-block case is returned so callers can delegate to native
 * browser selection instead of painting an overlay.
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
