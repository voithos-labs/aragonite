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
		await editor.focusBlockAtPath([0, 0], 11);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Control+x');
		await editor.waitForCrossBlock(false);
		const source = await editor.bridge.getSource();
		// "start wins": the blockquote context should survive.
		expect(source).toContain('>');
	});

	test('cut with anchor outside and focus inside blockquote', async () => {
		await editor.loadContent('before\n\n> quoted\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Control+x');
		await editor.waitForCrossBlock(false);
		const source = await editor.bridge.getSource();
		// "start wins": the paragraph context should survive.
		expect(source).toContain('before');
	});

	test('backspace across container boundary merges into start context', async () => {
		await editor.loadContent('top\n\n> inside quote\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Backspace');
		await editor.page.waitForTimeout(300);
		const source = await editor.bridge.getSource();
		expect(source).toContain('top');
	});

	test('cross-container cut then undo restores structure', async () => {
		await editor.loadContent('above\n\n> blockquote text\n');
		const before = await editor.bridge.getSource();
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Control+x');
		await editor.page.waitForTimeout(300);
		expect(await editor.bridge.getSource()).not.toBe(before);
		await editor.undo();
		await editor.page.waitForTimeout(300);
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('copy across container boundary collects correct text', async () => {
		await editor.loadContent('para\n\n> quote\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Control+c');
		await editor.page.waitForTimeout(100);
		expect(await editor.bridge.getSource()).toContain('para');
		expect(await editor.bridge.getSource()).toContain('> quote');
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});

	test('copy from inside blockquote to paragraph then paste reproduces text', async () => {
		await editor.loadContent('> quoted text\n\noutside\n\ndestination\n');
		await editor.focusBlockAtPath([0, 0], 0);
		await editor.page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+c');
		await editor.page.waitForTimeout(100);

		await editor.page.keyboard.press('ArrowRight');
		await editor.waitForCrossBlock(false);
		await editor.focusBlockEnd(2);
		await editor.page.keyboard.press('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.bridge.getSource();
		const quotedCount = source.split('quoted text').length - 1;
		const outsideCount = source.split('outside').length - 1;
		expect(quotedCount).toBeGreaterThanOrEqual(2);
		expect(outsideCount).toBeGreaterThanOrEqual(2);
	});

	test('cut from paragraph across blockquote then undo restores both', async () => {
		await editor.loadContent('top paragraph\n\n> blockquote text\n\nbottom\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+x');
		await editor.waitForCrossBlock(false);

		const afterCut = await editor.bridge.getSource();
		expect(afterCut.length).toBeLessThan(before.length);

		await editor.undo();
		await editor.page.waitForTimeout(300);
		expect(await editor.bridge.getSource()).toBe(before);
	});
});
