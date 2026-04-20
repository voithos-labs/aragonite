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

		// Focus the first list item's contenteditable directly. List items
		// are nested under the list container; focusBlockEnd(0) would target
		// the outer list, which isn't a contenteditable surface.
		const firstItem = editor.page.locator('[contenteditable="true"]', { hasText: 'item one' });
		await firstItem.click();
		await editor.page.keyboard.press('End');

		await editor.typeSlowly(' extra');
		await editor.page.waitForTimeout(400);

		expect(await editor.getSource()).toContain('item one extra');

		await editor.undo();
		await editor.page.waitForFunction(
			(expected) => (window as any).__test.getSource() === expected,
			before
		);
		expect(await editor.getSource()).toBe(before);
	});

	test('typing in two different items produces two batches', async () => {
		const before = await editor.getSource();

		const firstItem = editor.page.locator('[contenteditable="true"]', { hasText: 'item one' });
		await firstItem.click();
		await editor.page.keyboard.press('End');
		await editor.typeSlowly(' A');
		await editor.page.waitForTimeout(400);

		const secondItem = editor.page.locator('[contenteditable="true"]', { hasText: 'item two' });
		await secondItem.click();
		await editor.page.keyboard.press('End');
		await editor.typeSlowly(' B');
		await editor.page.waitForTimeout(400);

		// Two undos revert each batch individually.
		await editor.undo();
		await editor.page.waitForFunction(
			() => !(window as any).__test.getSource().includes(' B')
		);
		expect((await editor.getSource()).includes(' B')).toBe(false);
		expect((await editor.getSource()).includes(' A')).toBe(true);

		await editor.undo();
		await editor.page.waitForFunction(
			(expected) => (window as any).__test.getSource() === expected,
			before
		);
		expect(await editor.getSource()).toBe(before);
	});
});
