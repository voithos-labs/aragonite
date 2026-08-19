import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
const TABLE_1ROW = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

test.describe('table block: row affordance menu', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
	});

	// One grip per CST row (the delimiter line is not a row), so nth(0) is the header
	// and nth(1) is the first body row.
	test('one row grip per row; the header grip offers insert/delete but no move or alignment', async ({
		page
	}) => {
		const grips = page.locator('[data-table-row-grip]');
		await expect(grips).toHaveCount(3);

		await page.hover('[role="table"]');
		await grips.nth(0).click(); // header row — positionally fixed

		await expect(page.getByRole('menuitem', { name: /insert row below/i })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: /delete row/i })).toBeEnabled();
		await expect(page.getByRole('menuitem', { name: /move row up/i })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: /move row down/i })).toBeDisabled();
		await expect(page.getByRole('group', { name: 'Column alignment' })).toHaveCount(0);
	});

	test('Delete row removes that body row', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-row-grip]').nth(1).click(); // first body row
		await page.getByRole('menuitem', { name: /delete row/i }).click();

		await editor.bridge.waitForSourceNotContains('| 1 | 2 |');
		expect(await editor.bridge.getSource()).toContain('| 3 | 4 |');
		await expect(page.getByRole('menu')).toHaveCount(0);
	});

	test('Insert row below adds a body row after the grip row', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-row-grip]').nth(1).click();
		await page.getByRole('menuitem', { name: /insert row below/i }).click();

		await expect(async () => {
			const lines = (await editor.bridge.getSource()).trim().split('\n');
			expect(lines.length).toBeGreaterThan(4); // header + delimiter + 3 body rows
		}).toPass();
	});

	test('Insert row above adds a body row before the grip row', async ({ page }) => {
		const before = (await editor.bridge.getSource()).trim().split('\n').length;
		await page.hover('[role="table"]');
		await page.locator('[data-table-row-grip]').nth(1).click();
		await page.getByRole('menuitem', { name: /insert row above/i }).click();

		await expect(async () => {
			const after = (await editor.bridge.getSource()).trim().split('\n').length;
			expect(after).toBe(before + 1);
		}).toPass();
	});

	test('Move row up is disabled on the first body row, enabled below it', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-row-grip]').nth(1).click(); // first body row
		await expect(page.getByRole('menuitem', { name: /move row up/i })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: /move row down/i })).toBeEnabled();
	});

	test('Move row down is disabled on the last body row', async ({ page }) => {
		await page.hover('[role="table"]');
		await page.locator('[data-table-row-grip]').nth(2).click(); // last body row
		await expect(page.getByRole('menuitem', { name: /move row down/i })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: /move row up/i })).toBeEnabled();
	});

	test('Delete row is disabled when only one body row remains', async ({ page }) => {
		await editor.loadContent(TABLE_1ROW);
		await page.hover('[role="table"]');
		await page.locator('[data-table-row-grip]').nth(1).click(); // the sole body row

		const deleteItem = page.getByRole('menuitem', { name: /delete row/i });
		await expect(deleteItem).toBeDisabled();

		const before = await editor.bridge.getSource();
		await deleteItem.click({ force: true });
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('row grips are pointer-events:none at rest', async ({ page }) => {
		// At rest the left-gutter dots are out of the hit-test path, so they can't
		// steal a caret click in cell A's left padding before the table is hovered.
		const pe = await page
			.locator('[data-table-row-grip]')
			.first()
			.evaluate((el) => getComputedStyle(el).pointerEvents);
		expect(pe).toBe('none');
	});

	test('a first-cell caret click lands in the cell while hovered', async ({ page }) => {
		// click() hovers first, lifting the row grip to pointer-events:auto; its
		// left-gutter geometry still leaves the cell body clickable.
		const firstBodyCell = page.locator('[role="cell"]').nth(2); // body row, col A ("1")
		await firstBodyCell.click();
		await expect(firstBodyCell).toBeFocused();
	});
});
