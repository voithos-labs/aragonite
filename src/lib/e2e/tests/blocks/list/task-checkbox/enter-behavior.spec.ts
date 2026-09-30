import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('task checkbox: Enter in a to-do', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// The completer replaces the paragraph outright rather than re-kinding it, and a marker left
	// standing in front of a table serializes a to-do the editor draws no box for.
	test('Enter completing a table takes the checkbox with the paragraph', async () => {
		await editor.loadContent('- [ ] \n');
		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.typeSlowly('| a | b |');

		await editor.page.keyboard.press('Enter');

		await editor.bridge.waitForSourceContains('| --- |');
		expect(await editor.bridge.getSource()).not.toContain('[ ]');
		await expect(editor.page.locator('.task-checkbox')).toHaveCount(0);
	});
});
