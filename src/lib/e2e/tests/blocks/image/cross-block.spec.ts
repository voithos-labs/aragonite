import { test, expect } from '@playwright/test';
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
		// user-select:none on the widget makes Selection.toString() exclude the
		// source span text; use Range.toString() to read the actual range content.
		const rangeText = await page.evaluate(() => {
			const s = window.getSelection();
			if (!s || s.rangeCount === 0) return '';
			return s.getRangeAt(0).toString();
		});
		expect(rangeText).toContain('![cat]');
	});

	test('cross-block delete removes whole widget', async ({ page }) => {
		await editor.loadContent('a![cat](/test-fixtures/sample.png)b\n');
		await editor.focusBlockStart(0);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Shift+ArrowRight');
		await page.keyboard.press('Shift+ArrowRight');
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches((src) => !src.includes('![cat]'));
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
