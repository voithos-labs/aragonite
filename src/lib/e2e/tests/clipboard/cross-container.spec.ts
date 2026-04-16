import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('cross-container clipboard: blockquote boundary', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('cut with anchor inside blockquote and focus outside', async () => {
		await editor.loadContent('> quoted line\n\noutside\n');
		// Focus inside the blockquote at end of its content
		await editor.focusBlockAtPath([0, 0], 11); // end of "quoted line"
		await editor.pressKey('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(true);
		await editor.pressKey('Control+x');
		await editor.page.waitForTimeout(300);
		expect(await editor.isCrossBlockActive()).toBe(false);
		const source = await editor.getSource();
		// "start wins": the blockquote context should survive
		expect(source).toContain('>');
	});

	test('cut with anchor outside and focus inside blockquote', async () => {
		await editor.loadContent('before\n\n> quoted\n');
		await editor.focusBlockEnd(0);
		// Extend down into blockquote
		await editor.pressKey('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(true);
		await editor.pressKey('Control+x');
		await editor.page.waitForTimeout(300);
		expect(await editor.isCrossBlockActive()).toBe(false);
		const source = await editor.getSource();
		// "start wins": the paragraph context should survive
		expect(source).toContain('before');
	});

	test('backspace across container boundary merges into start context', async () => {
		await editor.loadContent('top\n\n> inside quote\n');
		await editor.focusBlockEnd(0);
		// Extend selection into the blockquote
		await editor.pressKey('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(true);
		await editor.pressBackspace();
		await editor.page.waitForTimeout(300);
		const source = await editor.getSource();
		// The merged block should live at the start's context (top-level paragraph)
		expect(source).toContain('top');
	});

	test('cross-container cut then undo restores structure', async () => {
		await editor.loadContent('above\n\n> blockquote text\n');
		const before = await editor.getSource();
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+x');
		await editor.page.waitForTimeout(300);
		expect(await editor.getSource()).not.toBe(before);
		await editor.undo();
		await editor.page.waitForTimeout(300);
		expect(await editor.getSource()).toBe(before);
	});

	test('copy across container boundary collects correct text', async () => {
		await editor.loadContent('para\n\n> quote\n');
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(true);
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);
		// Document should be unchanged after copy
		expect(await editor.getSource()).toContain('para');
		expect(await editor.getSource()).toContain('> quote');
		expect(await editor.isCrossBlockActive()).toBe(true);
	});
});
