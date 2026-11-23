/**
 * One navigation at a time per block, since two overlapping navigations would move the caret
 * twice. A call while one is in progress replaces the pending target, so the newest wins.
 */
export interface NavigationQueue<T> {
	navigateTo(target: T): Promise<void>;
}

export function createNavigationQueue<T>(deps: {
	navigateTo: (target: T) => Promise<unknown>;
}): NavigationQueue<T> {
	let navigating = false;
	let pending: { target: T } | null = null;

	async function navigateTo(target: T): Promise<void> {
		pending = { target };
		if (navigating) return;
		navigating = true;
		try {
			while (pending) {
				const next = pending.target;
				pending = null;
				await deps.navigateTo(next);
			}
		} finally {
			navigating = false;
		}
	}

	return { navigateTo };
}
