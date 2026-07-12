import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

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
