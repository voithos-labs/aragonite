/**
 * Pure predicates over CST paths and selection points, plus the `DocPath`
 * brand home. No DOM, no document lookups — strictly arithmetic on indices.
 *
 * The predicates take `readonly number[]`: they order and compare any
 * path-shaped array regardless of what space it addresses, so brand-typing
 * them to `DocPath` would force a cast at every call site for zero gain.
 */

import type { SelectionPoint } from './primitives';

// ── Doc-absolute path brand ──────────────────────────────────────────────────

declare const docPathBrand: unique symbol;
/**
 * A path whose every prefix resolves from the document root — the dialect the
 * commit seam requires and G1.16 checks. The two commit-arg dialect fields
 * (`op.eventPath`, `snapshot.path`) carry this brand. `asDocPath` is the base
 * mint (the commit scope factories); the op families compose their paths
 * through the `extendDocPath`/`docPathFrom` helpers in
 * `cursor/coordinate-spaces.ts` — the neutral coordinate leaf every composer,
 * `tree-operations` included, reaches without a directory cycle. G1.16 stays
 * the runtime belt for JS callers the types don't bind.
 */
export type DocPath = number[] & { readonly [docPathBrand]: true };

export function asDocPath(indices: number[]): DocPath {
	return indices as DocPath;
}

// ── Path predicates ────────────────────────────────────────────────────────

/**
 * Compare two paths in document order. Ancestor-before-descendant:
 * `[2]` comes before `[2, 0]` (container opens before children).
 */
export function comparePaths(a: readonly number[], b: readonly number[]): number {
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		if (a[i] < b[i]) return -1;
		if (a[i] > b[i]) return 1;
	}
	if (a.length < b.length) return -1;
	if (a.length > b.length) return 1;
	return 0;
}

/** True if `prefix` equals `path` or is a strict ancestor of it. */
export function pathHasPrefix(path: readonly number[], prefix: readonly number[]): boolean {
	if (prefix.length > path.length) return false;
	for (let i = 0; i < prefix.length; i++) {
		if (path[i] !== prefix[i]) return false;
	}
	return true;
}

/** True if `ancestor` is a strict prefix of `descendant`'s path. */
export function isStrictAncestorOf(
	ancestor: readonly number[],
	descendant: readonly number[]
): boolean {
	if (ancestor.length >= descendant.length) return false;
	for (let i = 0; i < ancestor.length; i++) {
		if (ancestor[i] !== descendant[i]) return false;
	}
	return true;
}

export function pathsEqual(a: readonly number[], b: readonly number[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

/** Number of shared leading indices between two paths. */
export function sharedPrefixLength(a: readonly number[], b: readonly number[]): number {
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		if (a[i] !== b[i]) return i;
	}
	return len;
}

/** Longest shared prefix of two paths. */
export function lowestCommonAncestor(a: readonly number[], b: readonly number[]): number[] {
	const result: number[] = [];
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		if (a[i] !== b[i]) break;
		result.push(a[i]);
	}
	return result;
}

// ── Point predicates ───────────────────────────────────────────────────────

/** Value equality on path + offset. */
export function pointsEqual(a: SelectionPoint, b: SelectionPoint): boolean {
	if (a.offset !== b.offset) return false;
	if (a.path.length !== b.path.length) return false;
	for (let i = 0; i < a.path.length; i++) {
		if (a.path[i] !== b.path[i]) return false;
	}
	return true;
}

/**
 * True if `path` is strictly between `start` and `end` in document order
 * (exclusive of both endpoints).
 */
export function isPathBetween(
	path: readonly number[],
	start: readonly number[],
	end: readonly number[]
): boolean {
	return comparePaths(path, start) > 0 && comparePaths(path, end) < 0;
}

/**
 * True when path's entire subtree fits strictly inside (start, end). Stronger
 * than `walkBetween`'s doc-order "between", which includes endpoint ancestors.
 */
export function isPathSubtreeBetween(
	path: readonly number[],
	start: readonly number[],
	end: readonly number[]
): boolean {
	return (
		!isStrictAncestorOf(path, start) &&
		!isStrictAncestorOf(start, path) &&
		!isStrictAncestorOf(path, end) &&
		!isStrictAncestorOf(end, path) &&
		!pathsEqual(path, start) &&
		!pathsEqual(path, end)
	);
}
