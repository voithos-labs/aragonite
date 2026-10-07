import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { nextRow } from '../presentation/helpers';

test.describe('selection: getSelection() reports within-block ranges (Task 4)', () => {
	// A single-block selection must report distinct anchor and focus raw offsets, so a consumer
	// can read (start, end) for the common selection shape rather than a collapsed caret.
	test('forward, backward and collapsed carets each report their own anchor and focus', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();

		await test.step('a forward within-block selection reports distinct anchor and focus offsets', async () => {
			await nextRow(editor, 'Hello world\n');
			await editor.focusBlock(0, 0);
			for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowRight');

			expect(await editor.bridge.isCrossBlockActive()).toBe(false);
			const sel = await editor.bridge.getSelectionPaths();
			expect(sel?.anchor).toEqual({ path: [0], offset: 0 });
			expect(sel?.focus).toEqual({ path: [0], offset: 5 });
		});

		await test.step('a backward within-block selection reports the anchor after the focus', async () => {
			await nextRow(editor, 'Hello world\n');
			await editor.focusBlock(0, 5);
			for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowLeft');

			expect(await editor.bridge.isCrossBlockActive()).toBe(false);
			const sel = await editor.bridge.getSelectionPaths();
			expect(sel?.anchor).toEqual({ path: [0], offset: 5 });
			expect(sel?.focus).toEqual({ path: [0], offset: 0 });
		});

		await test.step('a collapsed caret still reports anchor === focus', async () => {
			await nextRow(editor, 'Hello world\n');
			await editor.focusBlock(0, 4);

			const sel = await editor.bridge.getSelectionPaths();
			expect(sel?.anchor).toEqual({ path: [0], offset: 4 });
			expect(sel?.focus).toEqual({ path: [0], offset: 4 });
		});
	});
});
