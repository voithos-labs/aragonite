import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('single-block clipboard: basics', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// One key apart (End vs Home); the copy path is identical.
	for (const [position, key, expected] of [
		['end appends', 'End', 'StartStart'],
		['start prepends', 'Home', 'StartStart']
	] as const) {
		test(`paste at ${position} the copied text`, async () => {
			await editor.loadContent('Start\n');
			await editor.focusBlockStart(0);
			for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowRight');
			await editor.page.keyboard.press('ControlOrMeta+c');
			await editor.page.keyboard.press(key);
			await editor.paste();
			await editor.bridge.waitForSourceContains(expected);
		});
	}

	test('select text then paste replaces selection', async () => {
		await editor.loadContent('AAABBB\n');
		await editor.focusBlockStart(0);
		for (let i = 0; i < 3; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.page.keyboard.press('ArrowRight');
		for (let i = 0; i < 3; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.paste();
		await editor.bridge.waitForSourceContains('AAAAAA');
		expect(await editor.bridge.getSource()).not.toContain('BBB');
	});

	test('select text then type replaces selection with typed text', async () => {
		await editor.loadContent('OldText\n');
		await editor.focusBlockStart(0);
		for (let i = 0; i < 3; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.typeText('New');
		await editor.bridge.waitForSourceContains('NewText');
		expect(await editor.bridge.getSource()).not.toContain('Old');
	});

	test('cut then undo restores text', async () => {
		await editor.loadContent('Restore me\n');
		const before = await editor.bridge.getSource();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 7; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('ControlOrMeta+x');
		await editor.bridge.waitForSourceNotContains('Restore');

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
	});

	test('copy does not modify source', async () => {
		await editor.loadContent('Unchanged\n');
		const sourceBefore = await editor.bridge.getSource();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();

		expect(await editor.bridge.getSource()).toBe(sourceBefore);
	});

	test('cut empty selection is a no-op', async () => {
		await editor.loadContent('NoChange\n');
		const sourceBefore = await editor.bridge.getSource();
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('ControlOrMeta+x');
		await editor.waitForClipboardWrite();

		expect(await editor.bridge.getSource()).toBe(sourceBefore);
	});

	test('pasting single line stays inline', async () => {
		await editor.loadContent('Hello \n');
		await editor.focusBlock(0, 6);
		await editor.seedClipboard('world');
		await editor.paste();
		await editor.bridge.waitForSourceContains('Hello world');
		expect(await editor.bridge.getBlockCount()).toBe(1);
	});

	test('select word via Shift+Arrow then cut+paste elsewhere', async () => {
		await editor.loadContent('First\n\nSecond\n');
		await editor.focusBlockStart(0);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('ControlOrMeta+x');
		await editor.bridge.waitForSource((s) => !s.includes('First'));

		await editor.focusBlockEnd(1);
		await editor.paste();
		await editor.bridge.waitForSourceContains('SecondFirst');
	});

	test('select all in block via Ctrl+A then replace by typing', async () => {
		await editor.loadContent('Replace this entirely\n');
		await editor.focusBlockStart(0);
		await editor.selectAll();
		await editor.typeText('Brand new');
		await editor.bridge.waitForSourceContains('Brand new');
		expect(await editor.bridge.getSource()).not.toContain('Replace this entirely');
	});
});
