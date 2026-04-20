import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('nested list item — typing + undo', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('- item one\n- item two\n');
	});

	test('type into a list item → Ctrl+Z reverts the batch exactly', async () => {
		const before = await editor.getSource();

		// Focus end of the first list item.
		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' extra');
		await editor.page.waitForTimeout(400);

		expect(await editor.getSource()).toContain('item one extra');

		await editor.undo();
		expect(await editor.getSource()).toBe(before);
	});

	test('typing in two different items produces two batches', async () => {
		const before = await editor.getSource();

		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' A');
		await editor.page.waitForTimeout(400);

		await editor.focusBlockEnd(1);
		await editor.typeSlowly(' B');
		await editor.page.waitForTimeout(400);

		// Two undos revert each batch individually.
		await editor.undo();
		expect((await editor.getSource()).includes(' B')).toBe(false);
		expect((await editor.getSource()).includes(' A')).toBe(true);

		await editor.undo();
		expect(await editor.getSource()).toBe(before);
	});
});
