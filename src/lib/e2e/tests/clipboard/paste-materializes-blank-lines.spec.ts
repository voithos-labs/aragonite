import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('paste materializes blank lines as empty-paragraph blocks', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typed: produces 3 blocks', async () => {
		await editor.loadContent('');
		await editor.focusBlockAtPath([0], 0);
		await editor.typeText('one');
		await editor.page.keyboard.press('Enter');
		await editor.page.keyboard.press('Enter');
		await editor.typeText('two');
		await editor.page.waitForTimeout(200);

		expect(await editor.bridge.getSource()).toBe('one\n\ntwo\n');
		expect(await editor.bridge.getDomBlockCount()).toBe(3);
	});

	test('pasted via clipboard: same source, should produce 3 blocks (matches typed)', async () => {
		await editor.loadContent('');
		await editor.page.evaluate(() => navigator.clipboard.writeText('one\n\ntwo'));
		await editor.page.waitForTimeout(100);
		await editor.focusBlockAtPath([0], 0);
		await editor.page.keyboard.press('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.bridge.getSource();
		const domCount = await editor.bridge.getDomBlockCount();

		// Windows clipboard writes CRLF.
		expect(src.replace(/\r\n/g, '\n').replace(/\s+$/, '')).toBe('one\n\ntwo');
		expect(domCount).toBe(3);
	});
});
