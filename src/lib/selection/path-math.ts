/**
 * Pure predicates over CST paths. They take `readonly number[]` rather than `DocPath`: they order
 * any path-shaped array whatever it addresses, and the brand would force a cast at every call site.
 */

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

// ── Range predicates ───────────────────────────────────────────────────────

/** True if `path` is strictly between `start` and `end` in document order. */
export function isPathBetween(
	path: readonly number[],
	start: readonly number[],
	end: readonly number[]
): boolean {
	return comparePaths(path, start) > 0 && comparePaths(path, end) < 0;
}

/** True when `path`'s entire subtree fits strictly inside (start, end). Stronger than
 *  `walkBetween`'s document-order "between", which includes endpoint ancestors. */
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
