import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('image cross-block selection', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+ArrowRight extends selection atomically across widget', async ({ page }) => {
		await editor.loadContent('a![cat](/test-fixtures/sample.png)b\n');
		await editor.focusBlockStart(0);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Shift+ArrowRight');
		// The widget carries no textContent, so range.toString() doesn't include
		// the source bytes. Check the structural assertion instead — the widget
		// element falls inside the Range bounds.
		const widgetInRange = await page.evaluate(() => {
			const s = window.getSelection();
			if (!s || s.rangeCount === 0) return false;
			const range = s.getRangeAt(0);
			const widget = document.querySelector('[data-image-widget]');
			return widget ? range.intersectsNode(widget) : false;
		});
		expect(widgetInRange).toBe(true);
	});

	test('cross-block delete removes whole widget', async ({ page }) => {
		await editor.loadContent('a![cat](/test-fixtures/sample.png)b\n');
		await editor.focusBlockStart(0);
		await page.keyboard.press('ArrowRight');
		// One Shift+ArrowRight atomically jumps across the widget; the widget
		// is a single addressable unit so a second press would extend into 'b'.
		await page.keyboard.press('Shift+ArrowRight');
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('![cat]');
		expect(await editor.bridge.getSource()).toContain('ab\n');
	});

	test('undo restores deleted widget', async ({ page }) => {
		await editor.loadContent('a![cat](/test-fixtures/sample.png)b\n');
		await editor.focusBlockStart(0);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Shift+ArrowRight');
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Control+z');
		await editor.bridge.waitForSourceContains('![cat]');
	});
});
