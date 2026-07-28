import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('inline editing — formatting shortcuts', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+B wraps selection with **', async () => {
		await editor.loadContent('Hello world\n');
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 5; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.keyboard.press('Control+b');
		await editor.bridge.waitForSourceContains('Hello **world**');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello **world**');
	});

	test('Ctrl+B on already-bold text removes **', async () => {
		await editor.loadContent('Hello **world**\n');
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 9; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.keyboard.press('Control+b');
		await editor.bridge.waitForSourceContains('Hello world');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello world');
		expect(source).not.toContain('**');
	});

	test('Ctrl+I wraps selection with *', async () => {
		await editor.loadContent('Hello world\n');
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 5; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.keyboard.press('Control+i');
		await editor.bridge.waitForSourceContains('Hello *world*');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello *world*');
	});

	test('Ctrl+I on already-italic text removes *', async () => {
		await editor.loadContent('Hello *world*\n');
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 7; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.keyboard.press('Control+i');
		await editor.bridge.waitForSourceContains('Hello world');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello world');
		expect(source).not.toContain('*');
	});

	// Regression: selecting inner word of `**word**` and pressing Ctrl+B used to double-wrap to `****word****`.
	test('Ctrl+B on word flanked by markers strips them rather than double-wrapping', async () => {
		await editor.loadContent('Hello **world** today\n');
		await editor.focusBlock(0, 8);
		for (let i = 0; i < 5; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.keyboard.press('Control+b');
		await editor.bridge.waitForSourceContains('Hello world today');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello world today');
		expect(source).not.toContain('****');
	});
});
