/**
 * Post-replacement focus guard for `updateBlockContent`'s structural arm.
 *
 * A structural content commit restores the caret afterwards, but only when it
 * is servicing a live caret: while TYPING, focus either stays in the replaced
 * window's first block (identity-preserving multi-block split) or falls to
 * <body> when a kind change remounts the focused element — both need the
 * restore. A BLUR commit (render-primary source folding as focus lands in
 * another block) must not yank the caret back to the replacement.
 *
 * The discriminator is where focus lives at afterTick time: inside another
 * block's DOM (`data-block-path` outside the replaced window) means the caret
 * deliberately moved on.
 */
export function focusMovedOutsideReplacement(
	scopePath: number[],
	at: number,
	count: number
): boolean {
	if (typeof document === 'undefined') return false;
	const host = document.activeElement?.closest?.('[data-block-path]');
	const attr = host?.getAttribute('data-block-path');
	if (!attr) return false; // fell to body/root — a remount ate the focused el
	let path: number[];
	try {
		path = JSON.parse(attr) as number[];
	} catch {
		// A plugin may own data-block-path with non-JSON content; can't locate the
		// focus, so treat it like the fell-to-body case and run the restore.
		return false;
	}
	for (let depth = 0; depth < scopePath.length; depth++) {
		if (path[depth] !== scopePath[depth]) return true;
	}
	const index = path[scopePath.length];
	return index === undefined || index < at || index >= at + count;
}
