import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { gotoPageScroll, scrollPageTo } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Drag autoscroll where the window's own viewport is the scrollport. The edge math
// is rect-based, and in this shape there is no element whose rect is that
// scrollport: `document.scrollingElement`'s box is the whole document, thousands of
// pixels tall, so a pointer parked at the bottom of the screen is nowhere near its
// bottom edge. The window arm measures the viewport and writes the page's scroll.

const READING_OFFSET = 1100;
// Comfortably inside the viewport at READING_OFFSET, so grabbing its handle doesn't
// make Playwright scroll the page to reach it.
const DRAG_SOURCE = '[data-block-path="[30]"]';

const scrollY = (page: Page): Promise<number> => page.evaluate(() => window.scrollY);

/** Press the block's hover handle and hold the pointer at `clientY`. Returns once
 *  the drag is live; every caller cancels with Escape. */
async function dragHandleTo(page: Page, clientY: number): Promise<void> {
	const source = page.locator(DRAG_SOURCE);
	await source.hover();
	const handle = await source.locator('.block-drag-handle').first().boundingBox();
	expect(handle).not.toBeNull();
	await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle!.x + handle!.width / 2, clientY, { steps: 12 });
}

/** Escape cancels the drop, so every assertion above is about scrolling only. */
async function cancelDrag(page: Page): Promise<void> {
	await page.keyboard.press('Escape');
	await page.mouse.up();
}

test('a drag held at the bottom of the screen scrolls the page down', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page);
	await scrollPageTo(page, READING_OFFSET);
	const before = await scrollY(page);

	const viewport = page.viewportSize()!;
	await dragHandleTo(page, viewport.height - 5);
	await expect.poll(() => scrollY(page)).toBeGreaterThan(before + 50);

	await cancelDrag(page);
	expect(pageErrors).toEqual([]);
});

test('a drag held at the top of the screen scrolls the page up', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page);
	await scrollPageTo(page, READING_OFFSET);
	const before = await scrollY(page);

	// The negative arm: the same math with the pointer in the leading edge band, on a
	// page that has somewhere to go upward.
	await dragHandleTo(page, 5);
	await expect.poll(() => scrollY(page)).toBeLessThan(before - 50);

	await cancelDrag(page);
	expect(pageErrors).toEqual([]);
});
