import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

const TABLE_2x2 = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';
const TABLE_3ROW = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
const TABLE_3COL = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n';

test.describe('table block: keyboard vocabulary', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE_2x2);
	});

	test('Ctrl+Enter inserts a new row below and focuses its first cell', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Control+Enter');
		await editor.bridge.waitForSourceContains('| 1 | 2 |\n|  |  |\n');
		await expect(page.locator('[role="cell"]')).toHaveCount(6);
		await expect(page.locator('[role="cell"]').nth(4)).toBeFocused();
	});

	test('Ctrl+Shift+Enter inserts a new row above and focuses its first cell', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Control+Shift+Enter');
		await editor.bridge.waitForSourceContains('| --- | --- |\n|  |  |\n| 1 | 2 |\n');
		await expect(page.locator('[role="cell"]').nth(2)).toBeFocused();
	});

	test('Alt+Shift+ArrowRight inserts a column to the right and focuses the new cell', async ({
		page
	}) => {
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Alt+Shift+ArrowRight');
		await editor.bridge.waitForSourceContains('| A |  | B |');
		await editor.bridge.waitForSourceContains('| --- | --- | --- |');
		await expect(page.locator('[role="cell"]').nth(1)).toBeFocused();
	});

	test('Alt+Shift+ArrowLeft inserts a column to the left', async ({ page }) => {
		await page.locator('[role="cell"]').nth(1).click();
		await page.keyboard.press('Alt+Shift+ArrowLeft');
		await editor.bridge.waitForSourceContains('| A |  | B |');
		await editor.bridge.waitForSourceContains('| --- | --- | --- |');
	});

	test('Ctrl+Shift+Backspace deletes a body row when ≥2 body rows remain', async ({ page }) => {
		await editor.loadContent(TABLE_3ROW);
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Control+Shift+Backspace');
		await editor.bridge.waitForSourceNotContains('| 1 | 2 |');
		await editor.bridge.waitForSourceContains('| 3 | 4 |');
	});

	test('Alt+Shift+Backspace deletes the current column when ≥2 columns remain', async ({
		page
	}) => {
		await editor.loadContent(TABLE_3COL);
		await page.locator('[role="cell"]').nth(1).click();
		await page.keyboard.press('Alt+Shift+Backspace');
		await editor.bridge.waitForSourceContains('| A | C |');
		await editor.bridge.waitForSourceNotContains(' B ');
	});

	test('Ctrl+Shift+A from none jumps to center, then cycles left/center/right without revisiting none', async ({
		page
	}) => {
		await page.locator('[role="cell"]').nth(0).click();

		await page.keyboard.press('Control+Shift+A');
		await editor.bridge.waitForSourceContains('| :---: | --- |');

		await page.keyboard.press('Control+Shift+A');
		await editor.bridge.waitForSourceContains('| ---: | --- |');

		await page.keyboard.press('Control+Shift+A');
		await editor.bridge.waitForSourceContains('| :--- | --- |');

		await page.keyboard.press('Control+Shift+A');
		await editor.bridge.waitForSourceContains('| :---: | --- |');
	});

	test('Ctrl+Shift+Backspace is a no-op when only one body row remains', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click();
		const before = await editor.bridge.getSource();
		await page.keyboard.press('Control+Shift+Backspace');
		// No mutation expected; allow a short window for any (unwanted) commit to land.
		await page.waitForTimeout(150);
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Alt+Shift+Backspace is a no-op when only one column remains', async ({ page }) => {
		await editor.loadContent('| A |\n| --- |\n| 1 |\n');
		await page.locator('[role="cell"]').nth(0).click();
		const before = await editor.bridge.getSource();
		await page.keyboard.press('Alt+Shift+Backspace');
		await page.waitForTimeout(150);
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Deleting the header row promotes the next row to be the new header', async ({ page }) => {
		await editor.loadContent(TABLE_3ROW);
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Control+Shift+Backspace');
		await editor.bridge.waitForSourceContains('| 1 | 2 |\n| --- | --- |\n| 3 | 4 |\n');
		await editor.bridge.waitForSourceNotContains('| A | B |');
	});

	test('Shortcut mutations are single-undo-entry (Ctrl+Z restores prior state)', async ({
		page
	}) => {
		await page.locator('[role="cell"]').nth(2).click();
		const before = await editor.bridge.getSource();
		await page.keyboard.press('Control+Enter');
		await editor.bridge.waitForSourceContains('|  |  |');
		await editor.undo();
		await editor.bridge.waitForSourceNotContains('|  |  |');
		expect(await editor.bridge.getSource()).toBe(before);
	});
});
