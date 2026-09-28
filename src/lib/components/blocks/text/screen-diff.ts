/**
 * What a live rewrite says it did to the screen, as two checks over the text before and after
 * (live-mode.md § 2). Shared, so every caller asks the same questions of the same shapes instead
 * of writing its own traversal.
 */

/** Whether `after` is `before` with `text` spliced in at one place and nothing else moved. */
export function insertsExactly(before: string, after: string, text: string): boolean {
	if (after.length !== before.length + text.length) return false;
	let at = 0;
	while (at < before.length && before[at] === after[at]) at++;
	return (
		after.slice(at, at + text.length) === text && after.slice(at + text.length) === before.slice(at)
	);
}

/** Whether `after` is `before` with exactly `removed` gone from one place: everything a cut
 *  promises the user, asked of the bytes the parser produced rather than the ones it was given. */
export function removesExactly(before: string, after: string, removed: string): boolean {
	if (after.length !== before.length - removed.length) return false;
	let at = 0;
	while (at < after.length && before[at] === after[at]) at++;
	return (
		before.slice(at, at + removed.length) === removed &&
		after.slice(at) === before.slice(at + removed.length)
	);
}
