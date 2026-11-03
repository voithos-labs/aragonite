import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { pointAtRaw } from '../../text-runs';
import { fingerDrag, openTouch, PARAGRAPHS, RANGE } from '../../touch';
import { waitForFirstImageLoaded } from '../blocks/image/helpers';

// On a touch screen a swipe scrolls and never selects, and only a tap clears a range or a picture.
// Requirements: `e2e/requirements/selection/touch-press.md`.

const FILLER = Array.from({ length: 30 }, (_, i) => `filler line ${i + 1}`).join('\n\n');
const DOC = `${PARAGRAPHS}${FILLER}\n`;
// The range's formatting toolbar sits over the first paragraphs, so a gesture meant for the text
// lands on `filler line 4`, well below it.
const BELOW_RANGE = [6];
const PICTURE_DOC = `lead ![pic](/test-fixtures/sample.png) trail

${FILLER}
`;

test.use({ hasTouch: true });

/** How far every scrolled element on the page has scrolled, summed. */
function scrolled(page: Page): Promise<number> {
	return page.evaluate(() =>
		[document.scrollingElement, ...document.querySelectorAll('*')].reduce(
			(sum, el) => sum + (el?.scrollTop ?? 0),
			0
		)
	);
}

/** A finger swipe up from `path`'s text, which Chromium ends with a pointercancel as it scrolls,
 *  the order a phone gives. A swipe that never scrolled proves nothing, so it fails. */
async function swipeUpFrom(page: Page, path: number[]): Promise<void> {
	const before = await scrolled(page);
	const start = await pointAtRaw(page, path, 3);
	await fingerDrag(page, start, { x: start.x, y: start.y - 300 }, { steps: 10 });
	await expect.poll(() => scrolled(page), 'the swipe scrolled').toBeGreaterThan(before);
}

async function tapEndOf(page: Page, path: number[], offset: number): Promise<void> {
	const point = await pointAtRaw(page, path, offset);
	await page.touchscreen.tap(point.x + 2, point.y);
}

test('a swipe after a tap keeps the caret', async ({ page }) => {
	const editor = await openTouch(page, DOC);
	await tapEndOf(page, [0], 10);
	const caret = { path: [0], offset: 10 };
	await expect
		.poll(() => editor.bridge.getSelectionPaths())
		.toEqual({ anchor: caret, focus: caret });

	await swipeUpFrom(page, [1]);
	await editor.waitForRenderFlush();

	expect(await editor.bridge.getSelectionPaths()).toEqual({ anchor: caret, focus: caret });
});

test('a swipe keeps a range across blocks', async ({ page }) => {
	const editor = await openTouch(page, DOC);
	await tapEndOf(page, [0], 10);
	await page.evaluate((range) => (window as any).__test.setSelection(range), RANGE);
	await expect.poll(() => editor.bridge.getSelectionPaths()).toEqual(RANGE);

	await swipeUpFrom(page, BELOW_RANGE);
	await editor.waitForRenderFlush();

	expect(await editor.bridge.getSelectionPaths()).toEqual(RANGE);
});

test('a tap clears a range across blocks', async ({ page }) => {
	const editor = await openTouch(page, DOC);
	await tapEndOf(page, [0], 10);
	await page.evaluate((range) => (window as any).__test.setSelection(range), RANGE);
	await expect.poll(() => editor.bridge.getSelectionPaths()).toEqual(RANGE);

	await tapEndOf(page, BELOW_RANGE, 13);

	const caret = { path: BELOW_RANGE, offset: 13 };
	await expect
		.poll(() => editor.bridge.getSelectionPaths())
		.toEqual({ anchor: caret, focus: caret });
});

test('a swipe keeps a selected picture', async ({ page }) => {
	await openTouch(page, PICTURE_DOC);
	await waitForFirstImageLoaded(page);
	await tapPicture(page);

	await swipeUpFrom(page, BELOW_RANGE);

	await expect(page.locator('[data-image-overlay]')).toBeVisible();
});

test('a tap elsewhere clears a selected picture', async ({ page }) => {
	await openTouch(page, PICTURE_DOC);
	await waitForFirstImageLoaded(page);
	await tapPicture(page);

	await tapEndOf(page, BELOW_RANGE, 13);

	await expect(page.locator('[data-image-overlay]')).toHaveCount(0);
});

async function tapPicture(page: Page): Promise<void> {
	const box = await page.locator('[data-image-widget] img').first().boundingBox();
	if (!box) throw new Error('the picture has no box');
	await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.locator('[data-image-overlay]')).toBeVisible();
}
