import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Cells render row-major with the header cells first, so for TABLE the role="cell"
// order is: 0=A 1=B (header) · 2="1" 3="2" (body row 1) · 4="3" 5="4" (body row 2).
const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

test.describe('table block: cell right-click menu', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
	});

	test('right-click a cell opens the menu with BOTH row and column actions', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click({ button: 'right' }); // body cell ("1"), row 1 col 0

		await expect(page.getByRole('menuitem', { name: /delete row/i })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: /delete column/i })).toBeVisible();
	});

	test('Delete column removes the clicked cell column (colIdx routing)', async ({ page }) => {
		await page.locator('[role="cell"]').nth(1).click({ button: 'right' }); // header cell B, col 1
		await page.getByRole('menuitem', { name: /delete column/i }).click();

		await editor.bridge.waitForSourceMatches(/\| A \|\s*$/m); // only column A remains
		await editor.bridge.waitForSourceNotContains(' B ');
	});

	test('Delete row removes the clicked cell row (rowIdx routing)', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click({ button: 'right' }); // body cell ("1"), row 1
		await page.getByRole('menuitem', { name: /delete row/i }).click();

		await editor.bridge.waitForSourceNotContains('| 1 | 2 |');
		expect(await editor.bridge.getSource()).toContain('| 3 | 4 |');
	});

	test('right-clicking outside the table does not open the affordance menu', async ({ page }) => {
		await editor.loadContent(`${TABLE}text below\n`);
		await page.getByText('text below').click({ button: 'right' });
		await expect(page.getByRole('menu')).toHaveCount(0);
	});

	test('right-click within an active intra-table rectangle preserves the rectangle', async ({
		page
	}) => {
		await page.locator('[role="cell"]').nth(2).click(); // body ("1"), row 1 col 0
		await page
			.locator('[role="cell"]')
			.nth(5)
			.click({ modifiers: ['Shift'] }); // ("4"), row 2 col 1
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);

		// onPointerDown's selection clear must skip the right button, not run for any.
		await page.locator('[role="cell"]').nth(2).click({ button: 'right' });
		await expect(page.getByRole('menu')).toBeVisible();
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});
});
