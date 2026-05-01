import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

const COLS = 12;
// Long header content forces each column past the 80px floor (~150px each), so
// the total table width exceeds the default 1280px Playwright viewport and
// `.table-block` actually engages its `overflow-x: auto` scrollbar.
const HEAD =
	'| ' + Array.from({ length: COLS }, (_, i) => `Header-Col-${i + 1}`).join(' | ') + ' |\n';
const SEP = '| ' + Array.from({ length: COLS }, () => '---').join(' | ') + ' |\n';
const ROW = (prefix: string) =>
	'| ' + Array.from({ length: COLS }, (_, i) => `${prefix}${i + 1}`).join(' | ') + ' |\n';
const WIDE_TABLE = HEAD + SEP + ROW('a') + ROW('b');

// Cell index map (header stripped of the alignment row by the parser):
//   header cells: 0..11   (Col1..Col12)
//   body row 0:   12..23  (a1..a12)
//   body row 1:   24..35  (b1..b12)

test.describe('table block: wide-table horizontal scroll', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		// Constrain viewport so a 12-col table at ~150px/col reliably exceeds the
		// editor's content width and `.table-block` engages its overflow:auto.
		// Independent of host display size and Playwright defaults.
		await page.setViewportSize({ width: 800, height: 720 });
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('12-column table overflows horizontally with a scrollbar', async ({ page }) => {
		await editor.loadContent(WIDE_TABLE);
		const tableEl = page.locator('[role="table"]').first();
		const scrollWidth = await tableEl.evaluate((el) => el.scrollWidth);
		const clientWidth = await tableEl.evaluate((el) => el.clientWidth);
		expect(scrollWidth).toBeGreaterThan(clientWidth);
	});

	test('columns respect the 80px min-width floor', async ({ page }) => {
		await editor.loadContent(WIDE_TABLE);
		const cellWidths = await page
			.locator('[role="cell"]')
			.evaluateAll((cells) => cells.map((c) => (c as HTMLElement).getBoundingClientRect().width));
		// 80px floor; sub-pixel rounding tolerance.
		for (const w of cellWidths) expect(w).toBeGreaterThanOrEqual(79);
	});

	test('selection overlay tracks horizontal table scroll', async ({ page }) => {
		await editor.loadContent(WIDE_TABLE);

		// Drag-select cells a1..a3 (body row 0, cols 0..2) — three intra-table cells.
		const tableEl = page.locator('[role="table"]').first();
		const a1 = await page.locator('[role="cell"]').nth(12).boundingBox();
		const a3 = await page.locator('[role="cell"]').nth(14).boundingBox();
		if (!a1 || !a3) throw new Error('cells not laid out');
		await page.mouse.move(a1.x + a1.width / 2, a1.y + a1.height / 2);
		await page.mouse.down();
		await page.mouse.move(a3.x + a3.width / 2, a3.y + a3.height / 2, { steps: 10 });
		await page.mouse.up();

		expect(await editor.bridge.isCrossBlockActive()).toBe(true);

		const overlay = page.locator('.selection-overlay-endpoint').first();
		const beforeScroll = await overlay.boundingBox();
		expect(beforeScroll).not.toBeNull();

		await tableEl.evaluate((el) => {
			el.scrollLeft = 100;
		});
		await page.waitForTimeout(50); // one frame for the passive scroll listener to re-measure.

		const afterScroll = await overlay.boundingBox();
		expect(afterScroll).not.toBeNull();
		// Overlay must move with the scrolled cells.
		expect(afterScroll!.x).toBeLessThan(beforeScroll!.x);
	});

	test('drag-select reaches off-screen cells via inner autoscroll', async ({ page }) => {
		await editor.loadContent(WIDE_TABLE);
		const tableEl = page.locator('[role="table"]').first();
		const tableBox = await tableEl.boundingBox();
		if (!tableBox) throw new Error('table not laid out');

		const firstCell = page.locator('[role="cell"]').nth(12);
		const firstBox = await firstCell.boundingBox();
		if (!firstBox) throw new Error('first cell not laid out');

		await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(tableBox.x + tableBox.width - 5, firstBox.y + firstBox.height / 2, {
			steps: 5
		});
		// Hold near the right edge for a few hundred milliseconds so autoscroll accumulates.
		for (let i = 0; i < 20; i++) {
			await page.mouse.move(
				tableBox.x + tableBox.width - 5 - (i % 2),
				firstBox.y + firstBox.height / 2
			);
			await page.waitForTimeout(16);
		}
		await page.mouse.up();

		const finalScrollLeft = await tableEl.evaluate((el) => el.scrollLeft);
		expect(finalScrollLeft).toBeGreaterThan(0);
	});

	test('ArrowUp into a wide table re-enters near the column matching pre-exit X', async ({
		page
	}) => {
		await editor.loadContent(WIDE_TABLE + '\nbelow paragraph\n');

		// Body row 1 col 3 = cells[24+3] = cells[27] = "b4". Last body row, so
		// ArrowDown exits the table to the paragraph below.
		const b4Center = await page
			.locator('[role="cell"]')
			.nth(27)
			.evaluate((el) => {
				const r = el.getBoundingClientRect();
				return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
			});
		await page.mouse.click(b4Center.x, b4Center.y);
		await page.waitForTimeout(50);

		// ArrowDown exits the table; sticky X is captured at b4's cursor.
		// ArrowUp re-enters the last body row at the sticky-X column.
		// No typing in the paragraph in between — input events would reset sticky.
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowUp');
		await editor.typeSlowly('Z');

		const after = await editor.bridge.getSource();
		// Z lands at offset 0 of the target cell (focusCell uses 'start'), in
		// body row 1 (the bottom row). Allow ±1 col tolerance for sub-pixel
		// column-boundary crossings — b3, b4, or b5 is acceptable.
		expect(after).toMatch(/\| Zb[345] \|/);
		// Z must NOT land in the header or in body row 0 (a*).
		expect(after).not.toMatch(/\| ZHeader-Col-\d+ \|/);
		expect(after).not.toMatch(/\| Za\d+ \|/);
	});
});
