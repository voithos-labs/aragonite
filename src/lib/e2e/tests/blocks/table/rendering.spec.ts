import { test, expect } from '@playwright/test';
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
});
