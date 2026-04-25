import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('single-block clipboard: happy paths', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('select text with Shift+Arrow then copy+paste duplicates text', async () => {
		await editor.loadContent('abcdef\n');
		await editor.focusBlockStart(0);
		for (let i = 0; i < 3; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Control+c');
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('abcdefabc');

		const source = await editor.bridge.getSource();
		expect(source).toContain('abcdefabc');
	});

	test('select text then cut removes selected text', async () => {
		await editor.loadContent('HelloWorld\n');
		await editor.focusBlockStart(0);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Control+x');
		await editor.bridge.waitForSource((s) => !s.includes('Hello') && s.includes('World'));

		const source = await editor.bridge.getSource();
		expect(source).not.toContain('Hello');
		expect(source).toContain('World');
	});

	test('select text then paste replaces selection', async () => {
		await editor.loadContent('AAABBB\n');
		await editor.focusBlockStart(0);
		for (let i = 0; i < 3; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Control+c');
		await editor.page.keyboard.press('ArrowRight');
		for (let i = 0; i < 3; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('AAAAAA');

		const source = await editor.bridge.getSource();
		expect(source).toContain('AAAAAA');
		expect(source).not.toContain('BBB');
	});

	test('select text then type replaces selection with typed text', async () => {
		await editor.loadContent('OldText\n');
		await editor.focusBlockStart(0);
		for (let i = 0; i < 3; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.typeText('New');
		await editor.bridge.waitForSourceContains('NewText');

		const source = await editor.bridge.getSource();
		expect(source).toContain('NewText');
		expect(source).not.toContain('Old');
	});
});

test.describe('single-block clipboard: edge cases', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('cut then undo restores text', async () => {
		await editor.loadContent('Restore me\n');
		await editor.focusBlockStart(0);
		for (let i = 0; i < 7; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Control+x');
		await editor.bridge.waitForSource((s) => !s.includes('Restore'));
		expect(await editor.bridge.getSource()).not.toContain('Restore');

		await editor.undo();
		await editor.bridge.waitForSourceContains('Restore me');
		expect(await editor.bridge.getSource()).toContain('Restore me');
	});

	test('paste at end of block appends text', async () => {
		await editor.loadContent('Start\n');
		await editor.focusBlockStart(0);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Control+c');
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('StartStart');

		const source = await editor.bridge.getSource();
		expect(source).toContain('StartStart');
	});

	test('paste at start of block prepends text', async () => {
		await editor.loadContent('End\n');
		await editor.focusBlockStart(0);
		for (let i = 0; i < 3; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Control+c');
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('EndEnd');

		const source = await editor.bridge.getSource();
		expect(source).toContain('EndEnd');
	});

	test('copy does not modify source', async () => {
		await editor.loadContent('Unchanged\n');
		const sourceBefore = await editor.bridge.getSource();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Control+c');
		// wait 200ms — copy is a no-op for source; verify no spurious change settles in.
		await editor.page.waitForTimeout(200);

		const sourceAfter = await editor.bridge.getSource();
		expect(sourceAfter).toBe(sourceBefore);
	});

	test('cut empty selection is a no-op', async () => {
		await editor.loadContent('NoChange\n');
		const sourceBefore = await editor.bridge.getSource();
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Control+x');
		// wait 200ms — empty cut is a no-op for source; verify no spurious change settles in.
		await editor.page.waitForTimeout(200);

		const sourceAfter = await editor.bridge.getSource();
		expect(sourceAfter).toBe(sourceBefore);
	});

	test('pasting single line stays inline', async () => {
		await editor.loadContent('Hello \n');
		await editor.focusBlock(0, 6);
		await editor.page.evaluate(() => navigator.clipboard.writeText('world'));
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('Hello world');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello world');
		expect(await editor.bridge.getBlockCount()).toBe(1);
	});
});

test.describe('single-block clipboard: user interactions', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('select word via Shift+Arrow then cut+paste elsewhere', async () => {
		await editor.loadContent('First\n\nSecond\n');
		await editor.focusBlockStart(0);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Control+x');
		await editor.bridge.waitForSource((s) => !s.includes('First'));
		expect(await editor.bridge.getSource()).not.toContain('First');

		await editor.focusBlockEnd(1);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('SecondFirst');

		const source = await editor.bridge.getSource();
		expect(source).toContain('SecondFirst');
	});

	test('select all in block via Ctrl+A then replace by typing', async () => {
		await editor.loadContent('Replace this entirely\n');
		await editor.focusBlockStart(0);
		await editor.selectAll();
		await editor.typeText('Brand new');
		await editor.bridge.waitForSourceContains('Brand new');

		const source = await editor.bridge.getSource();
		expect(source).toContain('Brand new');
		expect(source).not.toContain('Replace this entirely');
	});
});
