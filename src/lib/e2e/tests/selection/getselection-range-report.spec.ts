import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('selection — getSelection() reports within-block ranges (Task 4)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// A single-block selection must surface distinct anchor/focus raw offsets, so a
	// consumer can read (start, end) for the common selection shape rather than a
	// collapsed caret.
	test('a forward within-block selection reports distinct anchor and focus offsets', async () => {
		await editor.loadContent('Hello world\n');
		await editor.focusBlock(0, 0);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowRight');

		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel?.anchor).toEqual({ path: [0], offset: 0 });
		expect(sel?.focus).toEqual({ path: [0], offset: 5 });
	});

	test('a backward within-block selection reports the anchor after the focus', async () => {
		await editor.loadContent('Hello world\n');
		await editor.focusBlock(0, 5);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowLeft');

		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel?.anchor).toEqual({ path: [0], offset: 5 });
		expect(sel?.focus).toEqual({ path: [0], offset: 0 });
	});

	test('a collapsed caret still reports anchor === focus', async () => {
		await editor.loadContent('Hello world\n');
		await editor.focusBlock(0, 4);

		const sel = await editor.bridge.getSelectionPaths();
		expect(sel?.anchor).toEqual({ path: [0], offset: 4 });
		expect(sel?.focus).toEqual({ path: [0], offset: 4 });
	});
});
