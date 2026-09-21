import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { gotoPageScroll, settleFrames, spacerCount } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// A held scroll position is released by the reader's next gesture. Under `scrollMode="host"`
// the page is what scrolls, so the gesture that takes the viewport back is one the editor never
// sees: with the release bound to the editor root, every measure pass re-asserts the position
// and the page stays stuck at the target until the reader happens to click inside the editor.
// The listeners follow whatever actually scrolls, not the root.

const TARGET_BLOCK = 120;

/** A point outside `.editor` but inside the scrolling page. Hit-tested rather than assumed: a
 *  point that quietly landed on the editor would leave this spec proving nothing. */
async function pointOutsideEditor(page: Page): Promise<{ x: number; y: number }> {
	const point = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const rect = editorEl.getBoundingClientRect();
		const candidate = { x: Math.max(2, Math.round(rect.left) - 8), y: window.innerHeight / 2 };
		const hit = document.elementFromPoint(candidate.x, candidate.y);
		return { ...candidate, insideEditor: !!hit && editorEl.contains(hit) };
	});
	expect(point.insideEditor, 'the wheel point must land outside the editor subtree').toBe(false);
	return { x: point.x, y: point.y };
}

function scrollY(page: Page): Promise<number> {
	return page.evaluate(() => window.scrollY);
}

test('a wheel outside the editor releases the reveal pin and the page scrolls', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page);

	// Windowing must be active, or nothing re-asserts the pin and the test proves nothing.
	expect(await spacerCount(page)).toBeGreaterThan(0);

	// The defaults: 'nearest' keeps holding the position, which is the state under test.
	expect(await page.evaluate((i) => (window as any).__test.rects.scrollTo([i]), TARGET_BLOCK)).toBe(
		true
	);
	const pinned = await scrollY(page);
	expect(pinned).toBeGreaterThan(0);

	const { x, y } = await pointOutsideEditor(page);
	await page.mouse.move(x, y);
	await page.mouse.wheel(0, 600);
	await page.waitForFunction((from) => window.scrollY !== from, pinned, { timeout: 5000 });

	// And it must stay moved: the reported failure is the reader being snapped back, which
	// happens on the next measure pass rather than at once.
	const moved = await scrollY(page);
	await settleFrames(page);
	await page.mouse.wheel(0, 600);
	await page.waitForFunction((from) => window.scrollY > from, moved, { timeout: 5000 });

	expect(await scrollY(page)).toBeGreaterThan(pinned);
	expect(pageErrors).toEqual([]);
});

// The other half of the rule: a held position nothing disturbs still holds. Without this case,
// releasing every time would pass.
test('the reveal pin holds when no gesture follows it', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page);

	expect(await page.evaluate((i) => (window as any).__test.rects.scrollTo([i]), TARGET_BLOCK)).toBe(
		true
	);
	const pinned = await scrollY(page);

	for (let i = 0; i < 5; i++) {
		await settleFrames(page);
	}

	expect(Math.abs((await scrollY(page)) - pinned)).toBeLessThan(4);
	expect(pageErrors).toEqual([]);
});
