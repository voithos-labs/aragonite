import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('table block: rendering', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('renders a simple table as a grid with role attributes', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		await expect(page.locator('[role="table"]')).toBeVisible();
		const rows = page.locator('[role="row"]');
		await expect(rows).toHaveCount(2);
		const cells = page.locator('[role="cell"]');
		await expect(cells).toHaveCount(4);
	});

	test('clicking a cell focuses it', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		const cell = page.locator('[role="cell"]').nth(0);
		await cell.click();
		await expect(cell).toBeFocused();
	});

	test('typing in a cell updates raw and round-trips', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		const cell = page.locator('[role="cell"]').nth(2);
		await cell.click();
		await page.keyboard.press('End');
		await editor.typeText('0');
		await editor.bridge.waitForSourceContains('| 10 | 2 |');
	});

	test('header-only table renders with one row', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n');
		const rows = page.locator('[role="row"]');
		await expect(rows).toHaveCount(1);
	});

	test('escaped pipe survives in cell content', async ({ page }) => {
		await editor.loadContent('| a | b \\| c |\n| --- | --- |\n');
		const cell = page.locator('[role="cell"]').nth(1);
		await expect(cell).toHaveText('b \\| c');
	});

	test('column alignment metadata applies as text-align even when cell has no padding whitespace', async ({
		page
	}) => {
		// Source intentionally omits the visual cell padding so any rendered
		// alignment must come from metadata, not from preserved leading spaces.
		await editor.loadContent('|L|C|R|\n|:---|:---:|---:|\n|a|b|c|\n');
		const cells = page.locator('[role="cell"]');
		await expect(cells.nth(0)).toHaveCSS('text-align', 'left');
		await expect(cells.nth(1)).toHaveCSS('text-align', 'center');
		await expect(cells.nth(2)).toHaveCSS('text-align', 'right');
		await expect(cells.nth(3)).toHaveCSS('text-align', 'left');
		await expect(cells.nth(4)).toHaveCSS('text-align', 'center');
		await expect(cells.nth(5)).toHaveCSS('text-align', 'right');
	});

	test('default alignment leaves text-align at the inherited start value', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		const cells = page.locator('[role="cell"]');
		// 'none' alignment should NOT set inline text-align — falls through to
		// whatever the document default is (LTR start = 'start').
		await expect(cells.nth(0)).toHaveCSS('text-align', 'start');
		await expect(cells.nth(1)).toHaveCSS('text-align', 'start');
	});

	test('hand-padded source renders cells with whitespace stripped', async ({ page }) => {
		// Cosmetic cell padding (the user's spaces between pipes) is non-semantic
		// content — it would interact awkwardly with text-align: center, distort
		// cursor placement, and pollute clipboard payloads. Cell display must
		// equal the trimmed content regardless of source padding.
		await editor.loadContent(
			'| Left     | Center   |    Right |\n| :------- | :------: | -------: |\n| Column A | Column B | Column C |\n| Row two  | data     |     $100 |\n'
		);
		const cells = page.locator('[role="cell"]');
		await expect(cells.nth(0)).toHaveText('Left');
		await expect(cells.nth(1)).toHaveText('Center');
		await expect(cells.nth(2)).toHaveText('Right');
		await expect(cells.nth(3)).toHaveText('Column A');
		await expect(cells.nth(5)).toHaveText('Column C');
		await expect(cells.nth(8)).toHaveText('$100');
	});
});
