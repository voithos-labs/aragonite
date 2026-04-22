import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';

test.describe('needsUndoCheckpoint — typing / structural / typing', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('Hello\n');
	});

	test('type-split-type produces three independent undo batches', async () => {
		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' one');
		// Wait past the 250ms debounce so the batch flushes.
		await editor.page.waitForTimeout(400);

		await editor.pressEnter();

		await editor.typeSlowly('two');
		await editor.page.waitForTimeout(400);

		await editor.undo();
		expect((await editor.getSource()).includes('two')).toBe(false);
		expect((await editor.getSource()).includes('Hello one')).toBe(true);

		await editor.undo();
		expect(await editor.getDomBlockCount()).toBe(1);
		expect((await editor.getSource()).trim()).toBe('Hello one');

		await editor.undo();
		expect((await editor.getSource()).trim()).toBe('Hello');

		const afterThreeUndos = await editor.getSource();
		await editor.undo();
		expect(await editor.getSource()).toBe(afterThreeUndos);
	});
});
