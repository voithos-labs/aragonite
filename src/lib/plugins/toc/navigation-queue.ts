/**
 * Per-block serialization for `rects.scrollTo`. The process-global reveal anchor
 * (`cursor/reveal-anchor.ts`) has no per-call ownership, so two `scrollTo`s
 * overlapping from one block would let the earlier call's terminal `clear()`
 * strand the later target's anchor mid-settle (m3-task-1-fix-review §F3): a
 * `'nearest'` scroll never clears the anchor on success, so the last-issued call
 * sets it last and wins the end-state, but a `!landed` or `'center'` predecessor
 * resolving late still fires a `clear()` that can nuke a later target's pin.
 *
 * Awaiting each scroll to completion before issuing the next means a block never
 * has two in flight — the anchor cannot leak — while a navigate mid-flight
 * overwrites the pending target, so the newest always wins and a superseded middle
 * target is dropped without an extra scroll.
 */
export interface NavigationQueue {
	/** Queue a scroll to `path`, superseding any pending target and running serial
	 *  with any in-flight scroll. */
	navigateTo(path: number[]): Promise<void>;
}

export function createNavigationQueue(deps: {
	scrollTo: (path: number[]) => Promise<unknown>;
}): NavigationQueue {
	let navigating = false;
	let pendingPath: number[] | null = null;

	async function navigateTo(path: number[]): Promise<void> {
		pendingPath = path;
		if (navigating) return;
		navigating = true;
		try {
			while (pendingPath) {
				const target = pendingPath;
				pendingPath = null;
				await deps.scrollTo(target);
			}
		} finally {
			navigating = false;
		}
	}

	return { navigateTo };
}
