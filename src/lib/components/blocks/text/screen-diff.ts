/**
 * What a live rewrite says it did to the screen, as two checks over the text before and after
 * (live-mode.md § 2). Shared, so every caller asks the same questions of the same shapes instead
 * of writing its own traversal.
 */

/** Whether `after` is `before` with `text` spliced in at one place and nothing else moved. */
export function insertsExactly(before: string, after: string, text: string): boolean {
	return after.length === before.length + text.length && splicedAt(before, after, text);
}

/** Whether `after` is `before` with exactly `removed` gone from one place: everything a cut
 *  promises the user, asked of the bytes the parser produced rather than the ones it was given. */
export function removesExactly(before: string, after: string, removed: string): boolean {
	return before.length === after.length + removed.length && splicedAt(after, before, removed);
}

/** Whether `longer` is `shorter` with `text` in at some offset. A run next to bytes like its own
 *  (` m` after `bold `) fits at several, so every offset both ends agree on is tried. */
function splicedAt(shorter: string, longer: string, text: string): boolean {
	let prefix = 0;
	while (prefix < shorter.length && shorter[prefix] === longer[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < shorter.length &&
		shorter[shorter.length - 1 - suffix] === longer[longer.length - 1 - suffix]
	) {
		suffix++;
	}
	for (let at = Math.max(0, shorter.length - suffix); at <= prefix; at++) {
		if (longer.startsWith(text, at)) return true;
	}
	return false;
}
