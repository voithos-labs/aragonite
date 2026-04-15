/**
 * Pure helpers for SelectionPoint paths. No DOM, no state — all functions
 * take and return plain values. Used by range-walker, range-delete, selection-
 * state, and the overlay classification helpers.
 */

import type { SelectionPoint, EditorSelection } from './selection-types';

// ── Path comparison ─────────────────────────────────────────────────────────

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

// ── Point equality ──────────────────────────────────────────────────────────

export function pointsEqual(a: SelectionPoint, b: SelectionPoint): boolean {
	if (a.offset !== b.offset) return false;
	if (a.path.length !== b.path.length) return false;
	for (let i = 0; i < a.path.length; i++) {
		if (a.path[i] !== b.path[i]) return false;
	}
	return true;
}

// ── Normalization ───────────────────────────────────────────────────────────

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

// ── Between predicate ───────────────────────────────────────────────────────

/**
 * True if `path` is strictly between `start` and `end` in document order
 * (exclusive of both endpoints). Used by overlay classification to decide
 * whether a block is a "middle block."
 */
export function isPathBetween(path: number[], start: number[], end: number[]): boolean {
	return comparePaths(path, start) > 0 && comparePaths(path, end) < 0;
}
