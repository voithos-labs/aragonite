import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('image properties popover', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('popover appears on selection', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await expect(page.locator('.md-image-properties')).toBeVisible();
	});

	test('popover disappears on deselect', async ({ page }) => {
		await editor.loadContent('text\n\n![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await expect(page.locator('.md-image-properties')).toBeVisible();
		await page.locator('.paragraph-block').first().click();
		await expect(page.locator('.md-image-properties')).not.toBeVisible();
	});

	test('URL edit commits into source on blur', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const urlInput = page.locator('.md-image-properties input').nth(0);
		await urlInput.fill('/test-fixtures/sample.png?v=2');
		await page.locator('.paragraph-block').first().click();
		await editor.bridge.waitForSourceContains('?v=2');
	});

	test('no-op blur does not add undo entry', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const undoLengthBefore = await page.evaluate(() => {
			return (window as any).__test?.dumpUndoStack?.()?.length ?? 0;
		});
		await page.locator('.paragraph-block').first().click();
		const undoLengthAfter = await page.evaluate(() => {
			return (window as any).__test?.dumpUndoStack?.()?.length ?? 0;
		});
		expect(undoLengthAfter).toBe(undoLengthBefore);
	});
});
