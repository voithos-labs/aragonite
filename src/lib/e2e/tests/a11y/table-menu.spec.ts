import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

test.describe('table action menu: keyboard + announcements', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
	});

	test('Shift+F10 opens the menu at the focused cell and focuses an enabled item', async ({
		page
	}) => {
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Shift+F10');

		await expect(page.getByRole('menu')).toBeVisible();
		await expect(page.locator('[role="menu"] :focus')).toHaveCount(1);
		await expect(page.locator('[role="menuitem"]:focus')).not.toBeDisabled();
	});

	test('arrow keys move between items and Enter invokes; the menu closes after', async ({
		page
	}) => {
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Shift+F10');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');

		await expect(page.getByRole('menu')).toHaveCount(0);
	});

	test('Escape closes the menu and returns focus to the cell', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Shift+F10');
		await expect(page.getByRole('menu')).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toHaveCount(0);

		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('Z');
	});

	test('Tab keeps focus within the open menu', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Shift+F10');

		await page.keyboard.press('Tab');
		await page.keyboard.press('Tab');
		await expect(page.locator('[role="menu"] :focus')).toHaveCount(1);
	});

	test('inserting a column announces it in the live region', async ({ page }) => {
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Alt+Shift+ArrowRight');

		await expect(page.locator('.editor-sr-live-reorder')).toHaveText(/insert/i);
	});

	test('deleting a row announces it in the live region', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click(); // first body row
		await page.keyboard.press(`${primaryModifier}+Shift+Backspace`);

		await expect(page.locator('.editor-sr-live-reorder')).toHaveText(/delet/i);
	});
});
