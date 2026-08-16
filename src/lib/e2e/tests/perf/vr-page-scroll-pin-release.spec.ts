import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { gotoPageScroll } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// A reveal pin is released by the next user-intent gesture. Under `scrollMode="host"` the
// scrollport is the PAGE, so the gesture that takes the viewport back is one the editor's own
// subtree never sees: with the release wiring bound to the editor root, every measure pass
// re-asserts the pin and the page is locked at the reveal target until the reader happens to
// click inside the editor. The listeners follow the resolved port, not the root.

const TARGET_BLOCK = 120;

/** A viewport point outside `.editor` but inside the scrolling page. Hit-tested rather than
 *  assumed: a point that silently landed on the editor would make the whole spec vacuous. */
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
	expect(await page.evaluate(() => document.querySelectorAll('.vr-spacer').length)).toBeGreaterThan(
		0
	);

	// Default opts: 'nearest' HOLDS the pin by contract, which is the state under test.
	expect(await page.evaluate((i) => (window as any).__test.rects.scrollTo([i]), TARGET_BLOCK)).toBe(
		true
	);
	const pinned = await scrollY(page);
	expect(pinned).toBeGreaterThan(0);

	const { x, y } = await pointOutsideEditor(page);
	await page.mouse.move(x, y);
	await page.mouse.wheel(0, 600);
	await page.waitForFunction((from) => window.scrollY !== from, pinned, { timeout: 5000 });

	// And it must STAY moved: the pin snapping the reader back is the filed failure, and it
	// lands on the next measure pass rather than immediately.
	const moved = await scrollY(page);
	await page.evaluate(
		() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
	);
	await page.mouse.wheel(0, 600);
	await page.waitForFunction((from) => window.scrollY > from, moved, { timeout: 5000 });

	expect(await scrollY(page)).toBeGreaterThan(pinned);
	expect(pageErrors).toEqual([]);
});

// The other half of the contract: a pin nothing disturbs still holds. Without this arm the
// release could be widened to "always release" and read green.
test('the reveal pin holds when no gesture follows it', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	await gotoPageScroll(page);

	expect(await page.evaluate((i) => (window as any).__test.rects.scrollTo([i]), TARGET_BLOCK)).toBe(
		true
	);
	const pinned = await scrollY(page);

	for (let i = 0; i < 5; i++) {
		await page.evaluate(
			() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
		);
	}

	expect(Math.abs((await scrollY(page)) - pinned)).toBeLessThan(4);
	expect(pageErrors).toEqual([]);
});
