import { expect, type Locator, type Page } from '@playwright/test';

// Shared by the specs that act at the end of a long, windowed document and read where the scroll
// container ends up.

/** Sub-pixel block heights can leave a scroll container a pixel short of its maximum. */
export const END_SLACK = 2;

/** Wheel down until the scroll container stops at its bottom, the way a reader gets there. Short
 *  steps mount and measure every block on the way, so no estimate is left to correct at the end. */
export async function wheelToBottom(page: Page, port: Locator): Promise<void> {
	const box = (await port.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await expect
		.poll(
			async () => {
				await page.mouse.wheel(0, 400);
				return port.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
			},
			{ timeout: 40_000, intervals: [50] }
		)
		.toBeLessThan(END_SLACK);
}
