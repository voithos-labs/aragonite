import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

/**
 * Deeply nested structural paste — the scenarios most likely to expose
 * seams in the dispatch / container-state machinery.
 */
test.describe('clipboard exploration: deeply nested', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paste multi-paragraph into a nested list item (list > item > paragraph)', async () => {
		await editor.loadContent('- outer\n  - nested target\n- tail\n');
		await editor.page.evaluate(() =>
			navigator.clipboard.writeText('pasted one\n\npasted two\n')
		);
		await editor.page.waitForTimeout(100);

		// Nested item's paragraph: path [0, 0, 1, 0, 0] (list > item > list > item > para)
		await editor.focusBlockAtPath([0, 0, 1, 0, 0], 'nested target'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		expect(src).toContain('pasted one');
		expect(src).toContain('pasted two');
	});

	test('paste structural into list item inside blockquote (blockquote > list > item > paragraph)', async () => {
		await editor.loadContent('> - bq item\n');
		await editor.page.evaluate(() =>
			navigator.clipboard.writeText('# Heading\n\npara\n')
		);
		await editor.page.waitForTimeout(100);

		// Path: document > blockquote > list > listItem > paragraph.
		// Try to focus the paragraph inside the list item.
		await editor.focusBlockAtPath([0, 0, 0, 0], 0);
		await editor.page.keyboard.press('End');
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		expect(src).toContain('Heading');
		expect(src).toContain('para');
	});

	test('cross-block paste inside deeply nested list replaces selection', async () => {
		await editor.loadContent('- A\n  - B1\n  - B2\n  - B3\n- C\n');
		await editor.page.evaluate(() =>
			navigator.clipboard.writeText('- X1\n- X2\n')
		);
		await editor.page.waitForTimeout(100);

		// Cross-block selection across B1..B3 (inside the nested list).
		await editor.focusBlockAtPath([0, 0, 1, 0, 0], 0);
		await editor.shiftClickBlock([0, 0, 1, 2, 0], 'B3'.length);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		expect(src).toContain('X1');
		expect(src).toContain('X2');
		expect(src).toContain('A');
		expect(src).toContain('C');
	});
});
