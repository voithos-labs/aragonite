import { test, expect } from '../fixtures';
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
		await editor.bridge.waitForSourceContains(' one');
		await editor.waitForUndoBatchFlush();

		await editor.page.keyboard.press('Enter');

		await editor.typeSlowly('two');
		await editor.bridge.waitForSourceContains('two');
		await editor.waitForUndoBatchFlush();

		await editor.undo();
		expect((await editor.bridge.getSource()).includes('two')).toBe(false);
		expect((await editor.bridge.getSource()).includes('Hello one')).toBe(true);

		await editor.undo();
		expect(await editor.getDomBlockCount()).toBe(1);
		expect((await editor.bridge.getSource()).trim()).toBe('Hello one');

		await editor.undo();
		expect((await editor.bridge.getSource()).trim()).toBe('Hello');

		const afterThreeUndos = await editor.bridge.getSource();
		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(afterThreeUndos);
	});
});
