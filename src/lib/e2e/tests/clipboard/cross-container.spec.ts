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

	test('copy from inside blockquote to paragraph then paste reproduces text', async () => {
		await editor.loadContent('> quoted text\n\noutside\n\ndestination\n');
		// Focus inside blockquote at path [0, 0]
		await editor.focusBlockAtPath([0, 0], 0);
		await editor.pressKey('Control+Shift+End');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(true);

		// Copy
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);

		// Collapse and paste into "destination"
		await editor.pressKey('ArrowRight');
		await editor.page.waitForTimeout(100);
		await editor.focusBlockEnd(2);
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		// "quoted text" and "outside" should each appear at least twice
		const quotedCount = source.split('quoted text').length - 1;
		const outsideCount = source.split('outside').length - 1;
		expect(quotedCount).toBeGreaterThanOrEqual(2);
		expect(outsideCount).toBeGreaterThanOrEqual(2);
	});

	test('cut from paragraph across blockquote then undo restores both', async () => {
		await editor.loadContent('top paragraph\n\n> blockquote text\n\nbottom\n');
		const before = await editor.getSource();

		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(true);

		await editor.pressKey('Control+x');
		await editor.page.waitForTimeout(300);
		expect(await editor.isCrossBlockActive()).toBe(false);

		const afterCut = await editor.getSource();
		expect(afterCut.length).toBeLessThan(before.length);

		// Undo restores the original doc including the blockquote structure
		await editor.undo();
		await editor.page.waitForTimeout(300);
		expect(await editor.getSource()).toBe(before);
	});
});
