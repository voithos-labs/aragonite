import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { attachIme } from '../../simulation/ime';

// Text that arrives with no keydown before it (an IME commit, dictation, a soft keyboard):
// undoing it puts the caret back where the text went in, as it does for typed keys.
test.describe('undo cursor anchoring without a keydown', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	async function expectCaretAt(page: Page, path: number[], offset: number): Promise<void> {
		const point = { path, offset };
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.getSelection()))
			.toEqual({ anchor: point, focus: point });
	}

	test('text inserted by an input event alone undoes with the caret where it went in', async ({
		page
	}) => {
		await editor.loadContent('abc tail\n');
		await editor.focusBlock(0, 3);
		// `insertText` fires beforeinput and input with no keydown, which is the point here.
		await page.keyboard.insertText('xyz');
		await editor.bridge.waitForSourceContains('abcxyz tail');
		await editor.waitForUndoBatchFlush();
		await editor.undo();
		await editor.bridge.waitForSourceEquals('abc tail\n');
		await expectCaretAt(page, [0], 3);
	});

	test('an IME commit undoes with the caret where the composition began', async ({ page }) => {
		await editor.loadContent('abc tail\n');
		await editor.focusBlock(0, 3);
		const ime = await attachIme(page);
		await ime.compose('に');
		await ime.commit('日');
		await editor.bridge.waitForSourceContains('abc日 tail');
		await editor.waitForUndoBatchFlush();
		await editor.undo();
		await editor.bridge.waitForSourceEquals('abc tail\n');
		await expectCaretAt(page, [0], 3);
	});

	test('text inserted into a table cell by an input event alone undoes in place', async ({
		page
	}) => {
		await editor.loadContent('| abc tail | b |\n| --- | --- |\n| c | d |\n');
		await page.locator('.table-cell').first().click();
		await page.keyboard.press('Home');
		for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.insertText('xyz');
		await editor.bridge.waitForSourceContains('abcxyz tail');
		await editor.waitForUndoBatchFlush();
		await editor.undo();
		await editor.bridge.waitForSourceContains('| abc tail |');
		await page.keyboard.type('W');
		await editor.bridge.waitForSourceContains('| abcW tail |');
	});
});
