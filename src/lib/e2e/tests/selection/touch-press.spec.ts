import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { pointAtRaw } from '../../text-runs';
import { skipUnlessSupported } from '../../browser-engine';

// On a touch screen a swipe scrolls and never selects, and only a tap clears a range.
// Requirements: `e2e/requirements/selection/touch-press.md`.

const FILLER = Array.from({ length: 30 }, (_, i) => `filler line ${i + 1}`).join('\n\n');
const DOC = `alpha beta\n\ngamma delta\n\nepsilon zeta\n\n${FILLER}\n`;
const RANGE = { anchor: { path: [0], offset: 2 }, focus: { path: [1], offset: 5 } };
// The range's formatting toolbar sits over the first paragraphs, so a gesture meant for the text
// lands on `filler line 4`, well below it.
const BELOW_RANGE = [6];

test.use({ hasTouch: true });

async function open(page: Page): Promise<EditorPage> {
	skipUnlessSupported(page, 'touch');
	skipUnlessSupported(page, 'cdp');
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(DOC);
	return editor;
}

/** A finger swipe up from `path`'s text, as touch events: Chromium's input pipeline sends a move or
 *  two, then a pointercancel as it starts the scroll, the order a phone gives. */
async function swipeUpFrom(page: Page, path: number[]): Promise<void> {
	const start = await pointAtRaw(page, path, 3);
	const x = Math.round(start.x);
	const y = Math.round(start.y);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
	for (let step = 1; step <= 10; step++) {
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x, y: y - step * 30 }]
		});
	}
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await cdp.detach();
}

async function tapEndOf(page: Page, path: number[], offset: number): Promise<void> {
	const point = await pointAtRaw(page, path, offset);
	await page.touchscreen.tap(point.x + 2, point.y);
}

test('a swipe after a tap keeps the caret', async ({ page }) => {
	const editor = await open(page);
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
	const editor = await open(page);
	await tapEndOf(page, [0], 10);
	await page.evaluate((range) => (window as any).__test.setSelection(range), RANGE);
	await expect.poll(() => editor.bridge.getSelectionPaths()).toEqual(RANGE);

	await swipeUpFrom(page, BELOW_RANGE);
	await editor.waitForRenderFlush();

	expect(await editor.bridge.getSelectionPaths()).toEqual(RANGE);
});

test('a tap clears a range across blocks', async ({ page }) => {
	const editor = await open(page);
	await tapEndOf(page, [0], 10);
	await page.evaluate((range) => (window as any).__test.setSelection(range), RANGE);
	await expect.poll(() => editor.bridge.getSelectionPaths()).toEqual(RANGE);

	await tapEndOf(page, BELOW_RANGE, 13);

	const caret = { path: BELOW_RANGE, offset: 13 };
	await expect
		.poll(() => editor.bridge.getSelectionPaths())
		.toEqual({ anchor: caret, focus: caret });
});
