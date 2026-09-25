/**
 * One `rects.navigateTo` at a time per block, since two overlapping navigations would move the
 * caret twice. A call while one is in progress replaces the pending target, so the newest wins.
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
