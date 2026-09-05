import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('list Enter — sibling creation and mid-item split', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at end of item creates new sibling', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Alpha' });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSource((s) => (s.match(/^- /gm) ?? []).length >= 3);
		const markers = (await editor.bridge.getSource()).match(/^- /gm) ?? [];
		expect(markers.length).toBeGreaterThanOrEqual(3);
	});

	test('Enter in middle of item splits content', async () => {
		await editor.loadContent('- HelloWorld\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'HelloWorld' });
		await item.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSource((s) => s.includes('- Hello') && s.includes('- World'));
		const source = await editor.bridge.getSource();
		expect(source).toContain('- Hello');
		expect(source).toContain('- World');
	});

	// Regression: mid-item Enter must collapse to one undo snapshot, not two.
	test('Enter in middle of item: one Ctrl+Z restores original item', async () => {
		await editor.loadContent('- HelloWorld\n');
		const before = await editor.bridge.getSource();
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'HelloWorld' });
		await item.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('Enter');
		// '- HelloWorld' already contains '- Hello', so only the second item's
		// marker proves the split ran.
		await editor.bridge.waitForSourceContains('- World');
		expect(await editor.bridge.getSource()).toContain('- Hello');
		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
	});
});
