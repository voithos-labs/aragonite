import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';
import { waitForSourceContains } from './helpers';

test.describe('task checkbox — Enter creates new task item', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at end of checked task item creates a new unchecked task item', async () => {
		await editor.loadContent('- [x] done\n');
		await editor.focusBlockAtPath([0, 0, 0], 'done'.length);
		await editor.page.keyboard.press('Enter');
		await waitForSourceContains(editor, '- [x] done\n- [ ] ');
		expect((await editor.bridge.getSource()).trim()).toBe('- [x] done\n- [ ]');
	});

	test('Enter at end of unchecked task item creates a new unchecked task item', async () => {
		await editor.loadContent('- [ ] pending\n');
		await editor.focusBlockAtPath([0, 0, 0], 'pending'.length);
		await editor.page.keyboard.press('Enter');
		await waitForSourceContains(editor, '- [ ] pending\n- [ ] ');
		expect((await editor.bridge.getSource()).trim()).toBe('- [ ] pending\n- [ ]');
	});

	test('Enter at end of plain list item stays plain (control)', async () => {
		await editor.loadContent('- plain\n');
		await editor.focusBlockAtPath([0, 0, 0], 'plain'.length);
		await editor.page.keyboard.press('Enter');
		await waitForSourceContains(editor, '- plain\n- ');
		expect((await editor.bridge.getSource()).trim()).toBe('- plain\n-');
	});
});
