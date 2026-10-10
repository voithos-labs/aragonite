import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('image backspace/delete + type-replace', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace at the right boundary selects the widget, and a second one deletes it', async ({
		page
	}) => {
		await editor.loadContent('lead![cat](/test-fixtures/sample.png)\n');
		await editor.focusBlockEnd(0);
		await page.keyboard.press('Backspace');
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		expect(await editor.bridge.getSource()).toContain('![cat]');

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
		// ArrowRight from offset 0 selects the widget from its left side.
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		await page.keyboard.press('Delete');
		await editor.bridge.waitForSourceNotContains('![cat]');
		await page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceContains('![cat]');
		// `keyboard.press`, so the editor's keydown intercept fires: `insertText` skips keydown and
		// lands the character natively past the widget.
		await page.keyboard.press('X');
		await editor.bridge.waitForSourceContains('X![cat]');
		const src = await editor.bridge.getSource();
		expect(src).toMatch(/^X!\[cat\]/);
		expect(src).not.toMatch(/\)Xtrail/);
	});
});
