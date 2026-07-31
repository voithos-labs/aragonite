/**
 * Per-block serialization for `rects.navigateTo`. The reveal anchor
 * (`cursor/reveal-anchor.ts`) decides which pin survives a race but cannot un-land a
 * caret, and two overlapping navigations from one block land two. A mid-flight call
 * overwrites the pending target, so the newest wins with no extra scroll.
 */
export interface NavigationQueue {
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
