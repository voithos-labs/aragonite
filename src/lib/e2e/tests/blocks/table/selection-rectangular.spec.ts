import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { dragBetweenCells } from './helpers';

const TABLE_3x3 = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

test.describe('table block: rectangular selection', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE_3x3);
	});

	test('rectangular intra-table drag paints overlay across the rectangle', async ({ page }) => {
		await dragBetweenCells(page, 0, 4);
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel!.anchor.path).toEqual(sel!.focus.path);
		expect(sel!.anchor.offset).toBe(0);
		expect(sel!.focus.offset).toBe(4);
		expect(await page.locator('.selection-overlay').count()).toBeGreaterThan(0);
	});

	test('anti-diagonal rectangular selection paints the full bounding rect', async ({ page }) => {
		// Cell 2 = (row 0, col 2), top right; cell 6 = (row 2, col 0), bottom left.
		await dragBetweenCells(page, 2, 6);
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel!.anchor.offset).toBe(2);
		expect(sel!.focus.offset).toBe(6);
		expect(await page.locator('.selection-overlay').count()).toBeGreaterThan(0);
	});

	test('a rectangle inside one table paints nothing outside it', async ({ page }) => {
		// Cells 0 to 4 hold A, B, 1 and 2; C, 3 and the last row stay out.
		await dragBetweenCells(page, 0, 4);
		await editor.waitForCrossBlock(true);
		await expect(page.locator('.selection-overlay').first()).toBeAttached();

		const paintedOutside = () =>
			page.evaluate(() => {
				const painted = [...document.querySelectorAll('.selection-overlay')]
					.map((el) => el.getBoundingClientRect())
					.filter((r) => r.width > 0.5 && r.height > 0.5);
				const cells = [...document.querySelectorAll('.table-cell')].map((el) =>
					el.getBoundingClientRect()
				);
				const covers = (x: number, y: number) =>
					painted.some((r) => r.left <= x && x <= r.right && r.top <= y && y <= r.bottom);
				const outside = [2, 5, 6, 7, 8]
					.filter((i) =>
						covers(cells[i].left + cells[i].width / 2, cells[i].top + cells[i].height / 2)
					)
					.map((i) => `cell ${i}`);
				const tableRight = Math.max(...cells.map((c) => c.right));
				if (painted.some((r) => r.right > tableRight + 0.5)) outside.push('past the table');
				return outside;
			});
		await expect.poll(paintedOutside).toEqual([]);
	});
});
