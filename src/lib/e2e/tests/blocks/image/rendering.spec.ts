import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('image rendering', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('standalone image renders widget', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toBeVisible();
		await expect(widget.locator('img')).toBeVisible();
	});

	test('mid-paragraph image renders widget', async ({ page }) => {
		await editor.loadContent('intro ![cat](/test-fixtures/sample.png) outro\n');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toBeVisible();
	});

	test('|400 dimension applies width attribute', async ({ page }) => {
		await editor.loadContent('![cat|400](/test-fixtures/sample.png)\n');
		const img = page.locator('[data-image-widget] img').first();
		await expect(img).toHaveAttribute('width', '400');
	});

	test('|400x300 applies width and height', async ({ page }) => {
		await editor.loadContent('![cat|400x300](/test-fixtures/sample.png)\n');
		const img = page.locator('[data-image-widget] img').first();
		await expect(img).toHaveAttribute('width', '400');
		await expect(img).toHaveAttribute('height', '300');
	});

	test('image in table cell renders alt-only (no widget)', async ({ page }) => {
		await editor.loadContent('| col |\n| --- |\n| ![cat](/test-fixtures/sample.png) |\n');
		const cellWidget = page.locator('.table-block [data-image-widget]');
		await expect(cellWidget).toHaveCount(0);
	});

	test('image in heading renders widget', async ({ page }) => {
		await editor.loadContent('# title with ![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toBeVisible();
	});

	test('broken URL gets md-image-broken class', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/nonexistent.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toHaveClass(/md-image-broken/, { timeout: 5000 });
	});
});
