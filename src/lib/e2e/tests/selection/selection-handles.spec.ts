import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { pointAtRaw } from '../../text-runs';
import { skipUnlessSupported } from '../../browser-engine';

// On a touch screen the editor draws selection handles where the browser's can't reach, and a
// finger drags them across blocks and cells. Requirements: `e2e/requirements/selection/selection-handles.md`.

const DOC = 'alpha beta\n\ngamma delta\n\nepsilon zeta\n\nfiller line\n';
const TABLE_DOC = 'lead line\n\n| a | b |\n| --- | --- |\n| c | d |\n';
const RANGE = { anchor: { path: [0], offset: 2 }, focus: { path: [1], offset: 5 } };
const HANDLE = (end: 'start' | 'end') => `.selection-handle[data-handle="${end}"]`;

test.use({ hasTouch: true });

async function open(page: Page, doc = DOC): Promise<EditorPage> {
	skipUnlessSupported(page, 'touch');
	skipUnlessSupported(page, 'cdp');
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(doc);
	return editor;
}

/** A tap on block 0, which makes the last press a finger, then `selection` through the bridge. */
async function tapThenSelect(page: Page, selection: object): Promise<void> {
	const point = await pointAtRaw(page, [0], 1);
	await page.touchscreen.tap(point.x, point.y);
	await page.evaluate((s) => (window as any).__test.setSelection(s), selection);
}

/** A finger on `handle`, moved so the point the handle drags travels from `from` to `to`;
 *  `held` runs before the finger lifts. */
async function dragHandle(
	page: Page,
	handle: string,
	from: { x: number; y: number },
	to: { x: number; y: number },
	held?: () => Promise<void>
): Promise<void> {
	const box = await page.locator(handle).boundingBox();
	if (!box) throw new Error(`no ${handle} on the page`);
	const x = Math.round(box.x + box.width / 2);
	const y = Math.round(box.y + box.height / 2);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
	for (let step = 1; step <= 8; step++) {
		const touchPoints = [
			{
				x: Math.round(x + ((to.x - from.x) * step) / 8),
				y: Math.round(y + ((to.y - from.y) * step) / 8)
			}
		];
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints });
	}
	await held?.();
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await cdp.detach();
}

const selection = (editor: EditorPage) => editor.bridge.getSelectionPaths();

// A phone draws its own handles on any native range, so a range the editor paints holds none.
const nativeCollapsed = (page: Page) =>
	page.evaluate(() => document.getSelection()?.isCollapsed !== false);

test('a range across blocks gets a handle at each end after a tap', async ({ page }) => {
	await open(page);
	await tapThenSelect(page, RANGE);
	await expect(page.locator('.selection-handle')).toHaveCount(2);
	await expect(page.locator('.selection-handle-edge')).toHaveCount(0);
	expect(await nativeCollapsed(page)).toBe(true);
	const start = await pointAtRaw(page, [0], 2);
	const box = await page.locator(HANDLE('start')).boundingBox();
	expect(Math.abs(box!.x + box!.width - start.x)).toBeLessThan(2);
});

test('a range across blocks after a mouse click gets no handles', async ({ page }) => {
	await open(page);
	const point = await pointAtRaw(page, [0], 1);
	await page.mouse.click(point.x, point.y);
	await page.evaluate((s) => (window as any).__test.setSelection(s), RANGE);
	await expect.poll(() => page.evaluate(() => (window as any).__test.getSelection())).toBeTruthy();
	await expect(page.locator('.selection-handle')).toHaveCount(0);
});

test('the end handle dragged into a later block grows the range there', async ({ page }) => {
	const editor = await open(page);
	await tapThenSelect(page, RANGE);
	await dragHandle(
		page,
		HANDLE('end'),
		await pointAtRaw(page, [1], 5),
		await pointAtRaw(page, [2], 4)
	);
	await expect
		.poll(() => selection(editor))
		.toEqual({ anchor: RANGE.anchor, focus: { path: [2], offset: 4 } });
	expect(await nativeCollapsed(page)).toBe(true);
});

test('the start handle dragged into an earlier block grows the range there', async ({ page }) => {
	const editor = await open(page);
	const range = { anchor: { path: [1], offset: 2 }, focus: { path: [2], offset: 5 } };
	await tapThenSelect(page, range);
	await dragHandle(
		page,
		HANDLE('start'),
		await pointAtRaw(page, [1], 2),
		await pointAtRaw(page, [0], 3)
	);
	await expect
		.poll(() => selection(editor))
		.toEqual({ anchor: range.focus, focus: { path: [0], offset: 3 } });
});

test("a word at its block's end gets an edge handle that crosses into the next block", async ({
	page
}) => {
	const editor = await open(page);
	await tapThenSelect(page, { anchor: { path: [0], offset: 6 }, focus: { path: [0], offset: 10 } });
	await expect(page.locator('.selection-handle')).toHaveCount(1);
	await expect(page.locator(`${HANDLE('end')}.selection-handle-edge`)).toHaveCount(1);
	await dragHandle(
		page,
		HANDLE('end'),
		await pointAtRaw(page, [0], 10),
		await pointAtRaw(page, [1], 5),
		// Mid-drag, the word's native range is gone, or a phone would draw its handles beside ours.
		async () => {
			await expect
				.poll(() => page.evaluate(() => (window as any).__test.isCrossBlockActive()))
				.toBe(true);
			await expect.poll(() => nativeCollapsed(page)).toBe(true);
		}
	);
	await expect
		.poll(() => selection(editor))
		.toEqual({ anchor: { path: [0], offset: 6 }, focus: { path: [1], offset: 5 } });
});

test('a handle dragged across table cells grows a rectangle', async ({ page }) => {
	const editor = await open(page, TABLE_DOC);
	const cell = (offset: number) => ({ path: [1], offset, cellCoordinate: true });
	await tapThenSelect(page, { anchor: cell(0), focus: cell(1) });
	await expect(page.locator('.selection-handle')).toHaveCount(2);
	const cellBox = (row: number, col: number) =>
		page
			.locator(
				`[role="table"] [data-table-row-idx="${row}"] > :is([role="cell"], [role="columnheader"])`
			)
			.nth(col)
			.boundingBox();
	const from = (await cellBox(0, 1))!;
	const to = (await cellBox(1, 1))!;
	await dragHandle(
		page,
		HANDLE('end'),
		{ x: from.x + from.width, y: from.y + from.height / 2 },
		{ x: to.x + to.width / 2, y: to.y + to.height / 2 }
	);
	await expect
		.poll(() => page.evaluate(() => (window as any).__test.getSelection()))
		.toEqual({ anchor: cell(0), focus: cell(3) });
	void editor;
});

test('reading mode shows no handles', async ({ page }) => {
	const editor = await open(page);
	await tapThenSelect(page, RANGE);
	await expect(page.locator('.selection-handle')).toHaveCount(2);
	await editor.setPresentationMode('reading');
	await expect(page.locator('.selection-handle')).toHaveCount(0);
});

test("the toolbar sits above a finger's range, clear of its handles", async ({ page }) => {
	await open(page, `${'filler\n\n'.repeat(6)}${DOC}`);
	await tapThenSelect(page, { anchor: { path: [6], offset: 2 }, focus: { path: [7], offset: 5 } });
	const bar = page.locator('[data-testid="selection-toolbar"]');
	await expect(bar).toBeVisible();
	const first = await pointAtRaw(page, [6], 2);
	const barBox = (await bar.boundingBox())!;
	expect(barBox.y + barBox.height).toBeLessThan(first.y);
	for (const end of ['start', 'end'] as const) {
		const h = (await page.locator(HANDLE(end)).boundingBox())!;
		expect(h.y >= barBox.y + barBox.height || h.x >= barBox.x + barBox.width).toBe(true);
	}
});

test('the toolbar drops below the handles when there is no room above', async ({ page }) => {
	await open(page);
	await tapThenSelect(page, RANGE);
	const bar = page.locator('[data-testid="selection-toolbar"]');
	await expect(bar).toBeVisible();
	const barBox = (await bar.boundingBox())!;
	const end = (await page.locator(HANDLE('end')).boundingBox())!;
	expect(barBox.y).toBeGreaterThanOrEqual(end.y + end.height - 1);
});

test('an open editor menu hides the handles', async ({ page }) => {
	await open(page);
	await tapThenSelect(page, RANGE);
	await expect(page.locator('.selection-handle')).toHaveCount(2);
	await page.keyboard.press('Shift+F10');
	await expect(page.locator('.md-menu[role="menu"]')).toBeVisible();
	await expect(page.locator('.selection-handle')).toHaveCount(0);
});
