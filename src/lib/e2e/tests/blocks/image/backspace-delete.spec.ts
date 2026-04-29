import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('image backspace/delete + type-replace', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace at right boundary selects (no delete)', async ({ page }) => {
		await editor.loadContent('lead![cat](/test-fixtures/sample.png)\n');
		await editor.focusBlockEnd(0);
		await page.keyboard.press('Backspace');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toHaveClass(/md-image-selected/);
		expect(await editor.bridge.getSource()).toContain('![cat]');
	});

	test('second Backspace deletes', async ({ page }) => {
		await editor.loadContent('lead![cat](/test-fixtures/sample.png)\n');
		await editor.focusBlockEnd(0);
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('lead\n');
		expect(await editor.bridge.getSource()).not.toContain('![cat]');
	});

	test('type single character while selected replaces widget', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await page.keyboard.press('h');
		await editor.bridge.waitForSourceContains('h\n');
		expect(await editor.bridge.getSource()).not.toContain('![cat]');
	});

	test('paste markdown image while selected replaces widget', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await page.evaluate(() => {
			const dt = new DataTransfer();
			dt.setData('text/plain', '![dog](/test-fixtures/sample.png)');
			document.activeElement?.dispatchEvent(
				new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })
			);
		});
		await editor.bridge.waitForSourceContains('![dog]');
		expect(await editor.bridge.getSource()).not.toContain('![cat]');
	});

	test('undo restores the deleted widget', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches((src) => !src.includes('![cat]'));
		await page.keyboard.press('Control+z');
		await editor.bridge.waitForSourceContains('![cat]');
	});
});
