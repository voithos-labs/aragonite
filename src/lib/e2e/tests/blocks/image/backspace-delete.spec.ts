import { test, expect } from '../../../fixtures';
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
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
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
		await editor.bridge.waitForSourceNotContains('![cat]');
		await page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceContains('![cat]');
	});

	test('undo after Delete from widget.start restores caret at widget.start', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)trail\n');
		await editor.focusBlockStart(0);
		// ArrowRight from offset 0 enters widget selection via the atRight=false branch.
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		await page.keyboard.press('Delete');
		await editor.bridge.waitForSourceNotContains('![cat]');
		await page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceContains('![cat]');
		// Use keyboard.press so the CST keydown intercept fires (insertText
		// skips keydown and lands the char natively past the widget).
		await page.keyboard.press('X');
		await editor.bridge.waitForSourceContains('X![cat]');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/^X!\[cat\]/);
		expect(src).not.toMatch(/\)Xtrail/);
	});
});
