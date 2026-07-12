import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('image widget selection', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Selection feedback is the overlay portal (popover + resize handles) rendered
	// at the widget's bounds. Its presence is the only externally-observable
	// signal of widget-selected state.
	const overlay = (page: import('@playwright/test').Page) => page.locator('[data-image-overlay]');

	test('click on widget enters selected state', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
	});

	test('click outside widget exits selected state', async ({ page }) => {
		await editor.loadContent('intro\n\n![cat](/test-fixtures/sample.png)\n');
		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
		await page.locator('.paragraph-block').first().click();
		await expect(overlay(page)).toHaveCount(0);
	});

	test('ArrowLeft from right boundary enters selected state', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)trail\n');
		await editor.focusBlockEnd(0);
		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');
		await expect(overlay(page)).toBeVisible();
	});

	test('ArrowLeft while selected jumps to left boundary and deselects', async ({ page }) => {
		await editor.loadContent('lead![cat](/test-fixtures/sample.png)\n');
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');
		await expect(overlay(page)).toHaveCount(0);
		await editor.typeText('X');
		expect(await editor.bridge.getSource()).toContain('leadX![cat]');
	});

	test('Escape deselects', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(overlay(page)).toHaveCount(0);
	});
});
