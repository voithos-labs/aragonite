import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('image widget selection', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('click on widget enters selected state', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await expect(widget).toHaveClass(/md-image-selected/);
	});

	test('click outside widget exits selected state', async ({ page }) => {
		await editor.loadContent('intro\n\n![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await expect(widget).toHaveClass(/md-image-selected/);
		await page.locator('.paragraph-block').first().click();
		await expect(widget).not.toHaveClass(/md-image-selected/);
	});

	test('ArrowLeft from right boundary enters selected state', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)trail\n');
		await editor.focusBlockEnd(0);
		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toHaveClass(/md-image-selected/);
	});

	test('ArrowLeft while selected jumps to left boundary and deselects', async ({ page }) => {
		await editor.loadContent('lead![cat](/test-fixtures/sample.png)\n');
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).not.toHaveClass(/md-image-selected/);
		await editor.typeText('X');
		expect(await editor.bridge.getSource()).toContain('leadX![cat]');
	});

	test('Escape deselects', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await expect(widget).toHaveClass(/md-image-selected/);
		await page.keyboard.press('Escape');
		await expect(widget).not.toHaveClass(/md-image-selected/);
	});
});
