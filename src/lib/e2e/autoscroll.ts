import { expect, type Locator, type Page } from '@playwright/test';

// Waits on drag-autoscroll, shared by the block-drag and table reorder suites.

/**
 * Holds the pointer at `hold` and polls `readScroll` until it passes `threshold`. The autoscroll
 * loop keeps running only while Playwright's pointer state is fresh, so every poll moves the
 * mouse back to the hold point. No waitForTimeout.
 */
export async function pollAutoscrollPast(
	page: Page,
	hold: { x: number; y: number },
	readScroll: () => Promise<number>,
	threshold: number,
	timeout?: number
): Promise<void> {
	await expect
		.poll(
			async () => {
				await page.mouse.move(hold.x, hold.y);
				return readScroll();
			},
			timeout === undefined ? { intervals: [16] } : { intervals: [16], timeout }
		)
		.toBeGreaterThan(threshold);
}

/** Waits until `axis` holds still for two frames: a rect read mid-scroll is stale by the drop. */
export async function settleScroll(
	scroller: Locator,
	axis: 'scrollTop' | 'scrollLeft'
): Promise<void> {
	await expect
		.poll(
			() =>
				scroller.evaluate(
					(el, a) =>
						new Promise<boolean>((resolve) => {
							const before = el[a];
							requestAnimationFrame(() => requestAnimationFrame(() => resolve(el[a] === before)));
						}),
					axis
				),
			{ intervals: [0], timeout: 5000 }
		)
		.toBe(true);
}
