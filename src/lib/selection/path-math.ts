/**
 * Pure predicates over CST paths, plus the `DocPath` brand home. No DOM, no document lookups.
 * The predicates take `readonly number[]`: they order any path-shaped array regardless of what
 * space it addresses, so brand-typing them to `DocPath` would force a cast at every call site.
 */

// ── Doc-absolute path brand ──────────────────────────────────────────────────

declare const docPathBrand: unique symbol;
/**
 * A path whose every prefix resolves from the document root: the dialect the commit seam
 * requires and G1.16 checks (`op.eventPath` and `snapshot.path` carry it). `asDocPath` is the
 * base mint; op families compose through `extendDocPath`/`docPathFrom` in
 * `cursor/coordinate-spaces.ts`. G1.16 stays the runtime belt for JS callers types don't bind.
 */
export type DocPath = number[] & { readonly [docPathBrand]: true };

export function asDocPath(indices: number[]): DocPath {
	return indices as DocPath;
}

// ── Path predicates ────────────────────────────────────────────────────────

/** Document order, ancestor-before-descendant: `[2]` precedes `[2, 0]`. */
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

// ── Range predicates ───────────────────────────────────────────────────────

/** True if `path` is strictly between `start` and `end` in document order. */
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
