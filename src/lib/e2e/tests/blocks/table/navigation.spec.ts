import { test, expect } from '../../../fixtures';
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

	test('Tab from last cell of last row creates a new row', async ({ page }) => {
		await page.locator('[role="cell"]').nth(3).click();
		await page.keyboard.press('Tab');
		await expect(page.locator('[role="cell"]')).toHaveCount(6);
		await expect(page.locator('[role="cell"]').nth(4)).toBeFocused();
	});

	test('ArrowRight from the block above enters the FIRST cell at its start', async ({ page }) => {
		await editor.loadContent('Text before.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		await page.getByText('Text before.').click();
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('[role="cell"]').nth(0)).toBeFocused();
		await page.keyboard.type('X');
		await expect(page.locator('[role="cell"]').nth(0)).toHaveText(/^XA/);
	});

	test('ArrowLeft from the block below enters the LAST cell at its end', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n\nText after.\n');
		await page.getByText('Text after.').click();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('[role="cell"]').nth(3)).toBeFocused();
		await page.keyboard.type('X');
		await expect(page.locator('[role="cell"]').nth(3)).toHaveText(/2X$/);
	});

	test('ArrowDown exits table downward into next block', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n\nText after.\n');
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowDown');
		const focusedPath = await page.evaluate(
			() =>
				document.activeElement?.closest('[data-block-path]')?.getAttribute('data-block-path') ??
				null
		);
		expect(focusedPath).toBe('[1]');
	});

	test('ArrowUp exits table upward into previous block', async ({ page }) => {
		await editor.loadContent('Text before.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowUp');
		const focusedPath = await page.evaluate(
			() =>
				document.activeElement?.closest('[data-block-path]')?.getAttribute('data-block-path') ??
				null
		);
		expect(focusedPath).toBe('[0]');
	});

	test('ArrowDown moves to cell directly below in same column', async ({ page }) => {
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('ArrowDown');
		await expect(page.locator('[role="cell"]').nth(2)).toBeFocused();
	});

	test('ArrowUp inside the table lands at the start of the upper cell', async ({ page }) => {
		await editor.loadContent('| AAA | BBB |\n| --- | --- |\n| ccc | ddd |\n');
		// Click cell "ccc" (body row, col 0) and place caret at end (offset 3).
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowUp');
		// Type a marker and confirm it lands at the START of "AAA", not the end.
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('| !AAA | BBB |');
	});

	test('Enter in non-last row moves to cell directly below', async ({ page }) => {
		await page.locator('[role="cell"]').nth(0).click();
		await page.keyboard.press('Enter');
		await expect(page.locator('[role="cell"]').nth(2)).toBeFocused();
	});

	test('Enter in last row creates new row', async ({ page }) => {
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('Enter');
		await expect(page.locator('[role="cell"]')).toHaveCount(6);
		await expect(page.locator('[role="cell"]').nth(4)).toBeFocused();
	});
});
