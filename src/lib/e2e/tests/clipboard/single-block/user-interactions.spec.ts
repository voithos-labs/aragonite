import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

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
