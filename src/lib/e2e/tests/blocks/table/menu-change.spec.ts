import type { Page } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// The cell menu reports on `menuChange` like every editor menu, so a host's own selection chrome
// steps aside for it. Requirements: `requirements/blocks/table/menu-change.md`.
const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

const startCapture = (page: Page) =>
	page.evaluate(() => (window as any).__test.startMenuChangeCapture());
const stopCapture = (page: Page): Promise<boolean[]> =>
	page.evaluate(() => (window as any).__test.stopMenuChangeCapture());

test.describe('table block: the cell menu on menuChange', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
	});

	test('Shift+F10 opens the cell menu as true, Escape closes it as false', async ({ page }) => {
		await page.locator('.table-cell').nth(2).click();
		await startCapture(page);

		await page.keyboard.press('Shift+F10');
		await expect(page.getByRole('menu')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toHaveCount(0);

		expect(await stopCapture(page)).toEqual([true, false]);
	});

	test('a flyout opened and swapped over the open menu reads open once and closed once', async ({
		page
	}) => {
		await page.locator('.table-cell').nth(2).click();
		await startCapture(page);

		await page.keyboard.press('Shift+F10');
		await page.getByRole('menuitem', { name: 'Row', exact: true }).hover();
		await expect(page.getByRole('menuitem', { name: 'Insert row above' })).toBeVisible();
		await page.getByRole('menuitem', { name: 'Column', exact: true }).hover();
		await expect(page.getByRole('menuitem', { name: 'Insert column left' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toHaveCount(0);

		expect(await stopCapture(page)).toEqual([true, false]);
	});
});
