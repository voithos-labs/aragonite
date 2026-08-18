import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { pollAutoscrollPast } from '../../../autoscroll';

const COLS = 12;
// Long header content forces each column past the 80px floor (~150px each), so the table exceeds
// the default 1280px Playwright viewport and `.table-block` actually engages its `overflow-x: auto`
// scrollbar.
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
		// Constrain the viewport so a 12-col table at ~150px/col reliably exceeds the editor's
		// content width and `.table-block` engages overflow:auto, independent of host display size.
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

		// Overlay must move with the scrolled cells; poll until the scroll
		// listener re-measures and the overlay shifts left.
		await expect
			.poll(async () => (await overlay.boundingBox())?.x ?? Infinity)
			.toBeLessThan(beforeScroll!.x);
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
		// Poll scrollLeft until the held pointer's autoscroll advances it at all.
		await pollAutoscrollPast(
			page,
			{ x: tableBox.x + tableBox.width - 5, y: firstBox.y + firstBox.height / 2 },
			() => tableEl.evaluate((el) => el.scrollLeft),
			0
		);
		await page.mouse.up();
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

		// ArrowDown exits the table capturing the sticky X at b4's cursor; ArrowUp re-enters the
		// last body row at that column. No typing in between — input events would reset the sticky
		// column.
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowUp');
		await editor.typeSlowly('Z');

		const after = await editor.bridge.getSource();
		// Z lands at offset 0 of the target cell (focusCell uses 'start') in body row 1, the bottom
		// row; allow ±1 column of tolerance for sub-pixel boundary crossings.
		expect(after).toMatch(/\| Zb[345] \|/);
		// Z must NOT land in the header or in body row 0 (a*).
		expect(after).not.toMatch(/\| ZHeader-Col-\d+ \|/);
		expect(after).not.toMatch(/\| Za\d+ \|/);
	});
});
