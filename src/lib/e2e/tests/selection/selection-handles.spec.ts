import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import { pointAtRaw, type Point } from '../../text-runs';
import { fingerDrag, openTouch, PARAGRAPHS, RANGE } from '../../touch';

// On a touch screen the editor draws selection handles where the browser's can't reach, and a
// finger drags them across blocks and cells. Requirements: `e2e/requirements/selection/selection-handles.md`.

const DOC = `${PARAGRAPHS}filler line\n`;
const TABLE_DOC = 'lead line\n\n| a | b |\n| --- | --- |\n| c | d |\n';
const HANDLE = (end: 'start' | 'end') => `.selection-handle[data-handle="${end}"]`;

test.use({ hasTouch: true });

/** A tap on block 0, which makes the last press a finger, then `selection` through the bridge. */
async function tapThenSelect(page: Page, selection: object): Promise<void> {
	const point = await pointAtRaw(page, [0], 1);
	await page.touchscreen.tap(point.x, point.y);
	await page.evaluate((s) => (window as any).__test.setSelection(s), selection);
}

/** A finger on `handle`, moved so the point the handle drags travels from `from` to `to`. */
async function dragHandle(
	page: Page,
	handle: string,
	from: Point,
	to: Point,
	held?: () => Promise<void>
): Promise<void> {
	const box = await page.locator(handle).boundingBox();
	if (!box) throw new Error(`no ${handle} on the page`);
	const x = Math.round(box.x + box.width / 2);
	const y = Math.round(box.y + box.height / 2);
	await fingerDrag(page, { x, y }, { x: x + to.x - from.x, y: y + to.y - from.y }, { held });
}

const selection = (editor: EditorPage) => editor.bridge.getSelectionPaths();

// A phone draws its own handles on any native range, so a range the editor paints holds none.
const nativeCollapsed = (page: Page) =>
	page.evaluate(() => document.getSelection()?.isCollapsed !== false);

const caretInFocusedBlock = (page: Page) =>
	page.evaluate(() => {
		const s = document.getSelection();
		const caret = !!s && s.rangeCount === 1 && s.isCollapsed;
		return caret && !!document.activeElement?.contains(s.anchorNode);
	});

test('a range across blocks gets a handle at each end after a tap', async ({ page }) => {
	await openTouch(page, DOC);
	await tapThenSelect(page, RANGE);
	await expect(page.locator('.selection-handle')).toHaveCount(2);
	expect(await nativeCollapsed(page)).toBe(true);
	const start = await pointAtRaw(page, [0], 2);
	const box = await page.locator(HANDLE('start')).boundingBox();
	expect(Math.abs(box!.x + box!.width - start.x)).toBeLessThan(2);
});

test('a range across blocks after a mouse click gets no handles', async ({ page }) => {
	await openTouch(page, DOC);
	const point = await pointAtRaw(page, [0], 1);
	await page.mouse.click(point.x, point.y);
	await page.evaluate((s) => (window as any).__test.setSelection(s), RANGE);
	await expect.poll(() => page.evaluate(() => (window as any).__test.getSelection())).toBeTruthy();
	await expect(page.locator('.selection-handle')).toHaveCount(0);
});

test('the end handle dragged into a later block grows the range there', async ({ page }) => {
	const editor = await openTouch(page, DOC);
	await tapThenSelect(page, RANGE);
	const target = await pointAtRaw(page, [2], 4);
	// The handle follows the finger while it is down, though no native selection moves under it.
	const handleBelowTarget = async () =>
		(await page.locator(HANDLE('end')).boundingBox())!.y > target.y;
	await dragHandle(page, HANDLE('end'), await pointAtRaw(page, [1], 5), target, async () => {
		await expect.poll(handleBelowTarget).toBe(true);
	});
	await expect
		.poll(() => selection(editor))
		.toEqual({ anchor: RANGE.anchor, focus: { path: [2], offset: 4 } });
	expect(await nativeCollapsed(page)).toBe(true);
});

test('the start handle dragged into an earlier block grows the range there', async ({ page }) => {
	const editor = await openTouch(page, DOC);
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

test("the end handle dragged back into the range's first block keeps the range the editor's", async ({
	page
}) => {
	const editor = await openTouch(page, DOC);
	await tapThenSelect(page, { anchor: { path: [0], offset: 6 }, focus: { path: [1], offset: 5 } });
	await page.evaluate(() => {
		const seen: number[] = ((window as any).__rangeCounts = []);
		document.addEventListener('selectionchange', () =>
			seen.push(document.getSelection()?.rangeCount ?? 0)
		);
	});
	await dragHandle(
		page,
		HANDLE('end'),
		await pointAtRaw(page, [1], 5),
		await pointAtRaw(page, [0], 9),
		// Mid-drag a caret stays in a focused block: a phone draws handles on a native range and
		// drops its keyboard on an empty selection.
		async () => {
			await expect.poll(() => caretInFocusedBlock(page)).toBe(true);
		}
	);
	// Not even for a moment: the phone's keyboard drops the instant the selection empties.
	expect(await page.evaluate(() => (window as any).__rangeCounts)).not.toContain(0);
	await expect
		.poll(() => selection(editor))
		.toEqual({ anchor: { path: [0], offset: 6 }, focus: { path: [0], offset: 9 } });
	expect(await nativeCollapsed(page)).toBe(true);
	await expect(page.locator('[data-block-path="[0]"] .selection-overlay-endpoint')).not.toHaveCount(
		0
	);
	await expect(page.locator('.selection-handle')).toHaveCount(2);
});

test("a finger's double tap makes its word the editor's range, with a handle at each end", async ({
	page
}) => {
	const editor = await openTouch(page, DOC);
	const point = await pointAtRaw(page, [1], 2);
	await page.touchscreen.tap(point.x, point.y);
	await page.touchscreen.tap(point.x, point.y);
	await expect
		.poll(() => selection(editor))
		.toEqual({ anchor: { path: [1], offset: 0 }, focus: { path: [1], offset: 5 } });
	expect(await nativeCollapsed(page)).toBe(true);
	await expect(page.locator('.selection-handle')).toHaveCount(2);
});

// Miss-analysis: every desktop handle row started from a range across blocks; none dragged a
// finger's word, owned inside one block, out of that block.
test("the end handle of a finger's word dragged into the next block grows the range there", async ({
	page
}) => {
	const editor = await openTouch(page, DOC);
	const point = await pointAtRaw(page, [0], 2);
	await page.touchscreen.tap(point.x, point.y);
	await page.touchscreen.tap(point.x, point.y);
	await expect
		.poll(() => selection(editor))
		.toEqual({ anchor: { path: [0], offset: 0 }, focus: { path: [0], offset: 5 } });
	await dragHandle(
		page,
		HANDLE('end'),
		await pointAtRaw(page, [0], 5),
		await pointAtRaw(page, [1], 4)
	);
	await expect
		.poll(() => selection(editor))
		.toEqual({ anchor: { path: [0], offset: 0 }, focus: { path: [1], offset: 4 } });
	expect(await nativeCollapsed(page)).toBe(true);
});

test('a handle dragged across table cells grows a rectangle', async ({ page }) => {
	await openTouch(page, TABLE_DOC);
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
});

// Each handle shrinks the rectangle into the cell at its other corner: a range there from the
// cell's edge on the rectangle's side (the first cell's start, the last cell's end) to the finger.
const SHRINKS = [
	{ grab: 'end', cell: [0, 0], fromEdge: 'right', to: 5, want: { anchor: 0, focus: 5 } },
	{ grab: 'start', cell: [1, 1], fromEdge: 'left', to: 1, want: { anchor: 6, focus: 1 } }
] as const;

for (const {
	grab,
	cell: [row, col],
	fromEdge,
	to,
	want
} of SHRINKS) {
	test(`a rectangle's ${grab} handle shrunk back into the other corner keeps a range there`, async ({
		page
	}) => {
		await openTouch(page, 'lead line\n\n| apple | berry |\n| --- | --- |\n| cherry | damson |\n');
		const corner = (offset: number) => ({ path: [1], offset, cellCoordinate: true });
		await tapThenSelect(page, { anchor: corner(0), focus: corner(3) });
		await expect(page.locator('.selection-handle')).toHaveCount(2);
		const grabbed = (await page
			.locator(
				`[role="table"] [data-table-row-idx="${1 - row}"] > :is([role="cell"], [role="columnheader"])`
			)
			.nth(1 - col)
			.boundingBox())!;
		const path = [1, row, col];
		await dragHandle(
			page,
			HANDLE(grab),
			{
				x: fromEdge === 'right' ? grabbed.x + grabbed.width : grabbed.x,
				y: grabbed.y + grabbed.height / 2
			},
			await pointAtRaw(page, path, to)
		);
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.getSelection()))
			.toEqual({ anchor: { path, offset: want.anchor }, focus: { path, offset: want.focus } });
	});
}

test('reading mode shows no handles', async ({ page }) => {
	const editor = await openTouch(page, DOC);
	await tapThenSelect(page, RANGE);
	await expect(page.locator('.selection-handle')).toHaveCount(2);
	await editor.setPresentationMode('reading');
	await expect(page.locator('.selection-handle')).toHaveCount(0);
});

test("the toolbar sits above a finger's range, clear of its handles", async ({ page }) => {
	await openTouch(page, `${'filler\n\n'.repeat(9)}${DOC}`);
	await tapThenSelect(page, { anchor: { path: [9], offset: 2 }, focus: { path: [10], offset: 5 } });
	const bar = page.locator('[data-testid="selection-toolbar"]');
	await expect(bar).toBeVisible();
	const first = await pointAtRaw(page, [9], 2);
	const barBox = (await bar.boundingBox())!;
	expect(barBox.y + barBox.height).toBeLessThan(first.y);
	for (const end of ['start', 'end'] as const) {
		const h = (await page.locator(HANDLE(end)).boundingBox())!;
		expect(h.y >= barBox.y + barBox.height || h.x >= barBox.x + barBox.width).toBe(true);
	}
});

test('the toolbar moves past the end handle when there is no room above', async ({ page }) => {
	await openTouch(page, DOC);
	await tapThenSelect(page, RANGE);
	const bar = page.locator('[data-testid="selection-toolbar"]');
	await expect(bar).toBeVisible();
	const barBox = (await bar.boundingBox())!;
	const end = (await page.locator(HANDLE('end')).boundingBox())!;
	expect(barBox.x).toBeGreaterThanOrEqual(end.x + end.width - 1);
});

test("a finger's toolbar cuts and pastes as well as copies, and its Cut takes the range", async ({
	page
}) => {
	await openTouch(page, `${'filler\n\n'.repeat(9)}${DOC}`);
	await tapThenSelect(page, { anchor: { path: [9], offset: 2 }, focus: { path: [10], offset: 5 } });
	const row = (action: string) => page.locator(`[data-testid="toolbar-${action}"]`);
	for (const action of ['cut', 'copy', 'paste']) await expect(row(action)).toBeVisible();
	const cut = (await row('cut').boundingBox())!;
	await page.touchscreen.tap(cut.x + cut.width / 2, cut.y + cut.height / 2);
	await expect
		.poll(() => page.evaluate(() => (window as any).__test.getSource()))
		.toContain('al delta');
});

test("a mouse's toolbar copies, leaving cut and paste to the keyboard", async ({ page }) => {
	await openTouch(page, DOC);
	const point = await pointAtRaw(page, [0], 1);
	await page.mouse.click(point.x, point.y);
	await page.evaluate((s) => (window as any).__test.setSelection(s), RANGE);
	await expect(page.locator('[data-testid="toolbar-copy"]')).toBeVisible();
	await expect(page.locator('[data-testid="toolbar-cut"]')).toHaveCount(0);
	await expect(page.locator('[data-testid="toolbar-paste"]')).toHaveCount(0);
});
