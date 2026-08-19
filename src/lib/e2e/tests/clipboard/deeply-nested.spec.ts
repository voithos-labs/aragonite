import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('clipboard exploration: deeply nested', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paste multi-paragraph into a nested list item (list > item > paragraph)', async () => {
		await editor.loadContent('- outer\n  - nested target\n- tail\n');
		await editor.seedClipboard('pasted one\n\npasted two\n');

		await editor.focusBlockAtPath([0, 0, 1, 0, 0], 'nested target'.length);
		await editor.paste();
		await editor.bridge.waitForSourceContains('pasted one');

		const src = await editor.bridge.getSource();
		expect(src).toContain('pasted one');
		expect(src).toContain('pasted two');
	});

	test('paste structural into list item inside blockquote (blockquote > list > item > paragraph)', async () => {
		await editor.loadContent('> - bq item\n');
		await editor.seedClipboard('# Heading\n\npara\n');

		await editor.focusBlockAtPath([0, 0, 0, 0], 0);
		await editor.page.keyboard.press('End');
		await editor.paste();
		await editor.bridge.waitForSourceContains('Heading');

		const src = await editor.bridge.getSource();
		expect(src).toContain('Heading');
		expect(src).toContain('para');
	});

	test('cross-block paste inside deeply nested list replaces selection', async () => {
		await editor.loadContent('- A\n  - B1\n  - B2\n  - B3\n- C\n');
		await editor.seedClipboard('- X1\n- X2\n');

		await editor.focusBlockAtPath([0, 0, 1, 0, 0], 0);
		await editor.shiftClickBlock([0, 0, 1, 2, 0], 'B3'.length);
		await editor.waitForCrossBlock(true);

		await editor.paste();
		await editor.bridge.waitForSourceContains('X1');

		const src = await editor.bridge.getSource();
		expect(src).toContain('X1');
		expect(src).toContain('X2');
		expect(src).toContain('A');
		expect(src).toContain('C');
	});
});
