import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('table block: navigation', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
	});

	test('Tab moves to next cell within the row', async ({ page }) => {
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Tab');
		await expect(page.locator('[role="cell"]').nth(1)).toBeFocused();
	});

	test.fixme('Tab from last cell of last row creates a new row', async () => {
		// Implemented in Plan 4 — depends on tableContext.insertRowBelow.
	});

	test('ArrowDown exits table downward into next block', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n\nText after.\n');
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowDown');
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!Text after.');
	});

	test('ArrowUp exits table upward into previous block', async ({ page }) => {
		await editor.loadContent('Text before.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowUp');
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('Text before.!');
	});

	test('ArrowDown moves to cell directly below in same column', async ({ page }) => {
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('ArrowDown');
		await expect(page.locator('[role="cell"]').nth(2)).toBeFocused();
	});

	test('Enter in non-last row moves to cell directly below', async ({ page }) => {
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Enter');
		await expect(page.locator('[role="cell"]').nth(2)).toBeFocused();
	});

	test.fixme('Enter in last row creates new row', async () => {
		// Implemented in Plan 4 — depends on tableContext.insertRowBelow.
	});
});
