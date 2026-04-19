import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('DEBUG: visual blank-line discrepancy', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typed: produces 3 blocks', async () => {
		await editor.loadContent('');
		await editor.focusBlockAtPath([0], 0);
		await editor.typeText('one');
		await editor.pressEnter();
		await editor.pressEnter();
		await editor.typeText('two');
		await editor.page.waitForTimeout(200);

		expect(await editor.getSource()).toBe('one\n\ntwo\n');
		expect(await editor.getDomBlockCount()).toBe(3);
	});

	test('pasted via clipboard: same source, should produce 3 blocks (matches typed)', async () => {
		await editor.loadContent('');
		await editor.page.evaluate(() => navigator.clipboard.writeText('one\n\ntwo'));
		await editor.page.waitForTimeout(100);
		await editor.focusBlockAtPath([0], 0);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		const domCount = await editor.getDomBlockCount();
		console.log('[PASTED] source:', JSON.stringify(src));
		console.log('[PASTED] DOM count:', domCount);

		// Normalize CRLF (Windows clipboard writes) → LF.
		expect(src.replace(/\r\n/g, '\n').replace(/\s+$/, '')).toBe('one\n\ntwo');
		expect(domCount).toBe(3);
	});
});
