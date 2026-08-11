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

	test('anti-diagonal rectangular selection paints full bounding rect (regression for b840b18)', async ({
		page
	}) => {
		// Cell 2 = (row 0, col 2) — top-right; cell 6 = (row 2, col 0) — bottom-left.
		await dragBetweenCells(page, 2, 6);
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel!.anchor.offset).toBe(2);
		expect(sel!.focus.offset).toBe(6);
		expect(await page.locator('.selection-overlay').count()).toBeGreaterThan(0);
	});
});
