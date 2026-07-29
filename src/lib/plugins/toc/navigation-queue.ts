/**
 * Per-block serialization for `rects.navigateTo`. The reveal anchor owns which
 * pin survives when two navigations race (`cursor/reveal-anchor.ts` claims), but
 * the anchor cannot un-land a caret: a navigation places one at its target, so
 * two overlapping from ONE block would land two carets and each would drag the
 * viewport to its own block on the way.
 *
 * Awaiting each navigation before issuing the next means a block never has two in
 * flight, while a navigate mid-flight overwrites the pending target, so the newest
 * always wins and a superseded middle target is dropped without an extra scroll.
 */
export interface NavigationQueue {
	/** Queue a navigation to `path`, superseding any pending target and running
	 *  serial with any in-flight one. */
	navigateTo(path: number[]): Promise<void>;
}

export function createNavigationQueue(deps: {
	navigateTo: (path: number[]) => Promise<unknown>;
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
				await deps.navigateTo(target);
			}
		} finally {
			navigating = false;
		}
	}

	return { navigateTo };
}
