import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

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
		await editor.waitForClipboardWrite();

		const sourceAfter = await editor.bridge.getSource();
		expect(sourceAfter).toBe(sourceBefore);
	});

	test('cut empty selection is a no-op', async () => {
		await editor.loadContent('NoChange\n');
		const sourceBefore = await editor.bridge.getSource();
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Control+x');
		await editor.waitForClipboardWrite();

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
