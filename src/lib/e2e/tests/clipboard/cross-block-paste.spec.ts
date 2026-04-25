import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('cross-block clipboard: paste basics', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+V with cross-block selection deletes range and pastes', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.bridge.waitForCrossBlock(true);
		await editor.page.evaluate(() => navigator.clipboard.writeText('PASTED'));
		await editor.page.keyboard.press('Control+v');
		await editor.page.waitForTimeout(300);
		const source = await editor.bridge.getSource();
		expect(source).toContain('PASTED');
		expect(source).toContain('aaa');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
	});

	test('multi-block paste with single-block selection is one undo unit', async () => {
		await editor.loadContent('hello world\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('alpha\n\nbeta\n'));
		await editor.page.waitForTimeout(100);
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Control+v');
		await editor.page.waitForTimeout(300);
		const afterPaste = await editor.bridge.getSource();
		expect(afterPaste).toContain('alpha');
		expect(afterPaste).toContain('beta');
		expect(afterPaste).not.toContain('world');

		await editor.page.keyboard.press('Control+z');
		await editor.page.waitForTimeout(200);
		const afterUndo = await editor.bridge.getSource();
		expect(afterUndo.trim()).toBe('hello world');
	});
});

test.describe('cross-block clipboard: multi-block paste at single caret', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('pasting two paragraphs creates multiple blocks', async () => {
		await editor.loadContent('Hello\n');
		await editor.focusBlockEnd(0);
		await editor.page.evaluate(() => navigator.clipboard.writeText('# Heading\n\nNew paragraph\n'));
		await editor.page.keyboard.press('Control+v');
		await editor.page.waitForTimeout(300);
		const source = await editor.bridge.getSource();
		expect(source).toContain('# Heading');
		expect(source).toContain('New paragraph');
		expect(await editor.bridge.getBlockCount()).toBe(3);
	});

	test('multi-block paste replaces selected text', async () => {
		await editor.loadContent('Hello World\n');
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 5; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.evaluate(() => navigator.clipboard.writeText('First\n\nSecond'));
		await editor.page.keyboard.press('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.bridge.getSource();
		expect(source).not.toContain('World');
		expect(source).toContain('Hello ');
		expect(source).toContain('First');
		expect(source).toContain('Second');
	});
});
