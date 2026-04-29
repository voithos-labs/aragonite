import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('image cross-block selection', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Shift+Arrow doesn't extend atomically across widgets yet — extension goes
	// byte-by-byte through the source span. Targeted fix at 0.7 (the
	// `handleSharedKeydown` cross-block extension layer needs widget-boundary
	// awareness). Tracked as a known 0.6.4 limitation in the changelog.
	test.fixme('Shift+ArrowRight extends selection atomically across widget', async ({ page }) => {
		await editor.loadContent('a![cat](/test-fixtures/sample.png)b\n');
		await editor.focusBlockStart(0);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Shift+ArrowRight');
		const sel = await page.evaluate(() => {
			const s = window.getSelection();
			return s ? s.toString() : '';
		});
		expect(sel).toContain('![cat]');
	});

	test.fixme('cross-block delete removes whole widget', async ({ page }) => {
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
