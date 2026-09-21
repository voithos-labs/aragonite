import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('task checkbox: Enter in a to-do', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at end of checked task item creates a new unchecked task item', async () => {
		await editor.loadContent('- [x] done\n');
		await editor.focusBlockAtPath([0, 0, 0], 'done'.length);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('- [x] done\n- [ ] ');
		expect((await editor.bridge.getSource()).trim()).toBe('- [x] done\n- [ ]');
	});

	test('Enter at end of unchecked task item creates a new unchecked task item', async () => {
		await editor.loadContent('- [ ] pending\n');
		await editor.focusBlockAtPath([0, 0, 0], 'pending'.length);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('- [ ] pending\n- [ ] ');
		expect((await editor.bridge.getSource()).trim()).toBe('- [ ] pending\n- [ ]');
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

	test('Enter at end of plain list item stays plain (control)', async () => {
		await editor.loadContent('- plain\n');
		await editor.focusBlockAtPath([0, 0, 0], 'plain'.length);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('- plain\n- ');
		expect((await editor.bridge.getSource()).trim()).toBe('- plain\n-');
	});
});
