import { expect, type Locator, type Page } from '@playwright/test';

// Shared drag-autoscroll settles for the reorder suites (block drag + table row/column).

/**
 * Holds the pointer at `hold` and polls `readScroll` until it passes `threshold`. The
 * autoscroll rAF loop self-drives only while Playwright's pointer state stays fresh, so
 * every iteration re-moves the mouse to the hold point. Never waitForTimeout.
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

/** Settles once `axis` holds still across two frames — a rect read mid-scroll is stale by the drop. */
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
