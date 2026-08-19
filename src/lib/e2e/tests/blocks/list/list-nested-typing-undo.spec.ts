import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('nested list item — typing + undo', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('- item one\n- item two\n');
	});

	test('type into a list item → Ctrl+Z reverts the batch exactly', async () => {
		const before = await editor.bridge.getSource();

		const firstItem = editor.page.locator('[contenteditable="true"]', { hasText: 'item one' });
		await firstItem.click();
		await editor.page.keyboard.press('End');

		await editor.typeSlowly(' extra');
		await editor.bridge.waitForSourceContains('item one extra');

		expect(await editor.bridge.getSource()).toContain('item one extra');

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
	});

	test('typing in two different items produces two batches', async () => {
		const before = await editor.bridge.getSource();

		const firstItem = editor.page.locator('[contenteditable="true"]', { hasText: 'item one' });
		await firstItem.click();
		await editor.page.keyboard.press('End');
		await editor.typeSlowly(' A');
		await editor.waitForUndoBatchFlush();

		const secondItem = editor.page.locator('[contenteditable="true"]', { hasText: 'item two' });
		await secondItem.click();
		await editor.page.keyboard.press('End');
		await editor.typeSlowly(' B');
		await editor.bridge.waitForSourceContains('item two B');
		await editor.waitForUndoBatchFlush();

		await editor.undo();
		await editor.bridge.waitForSourceNotContains(' B');
		expect((await editor.bridge.getSource()).includes(' B')).toBe(false);
		expect((await editor.bridge.getSource()).includes(' A')).toBe(true);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
	});

	// A focus change between sibling items must break the debounce batch even before the 250ms
	// flush: the outer container's blockIndex was the only batch key, so sibling leaves shared a
	// batch.
	test('focus change between sibling items inside debounce window still breaks the batch', async () => {
		const before = await editor.bridge.getSource();

		const firstItem = editor.page.locator('[contenteditable="true"]', { hasText: 'item one' });
		await firstItem.click();
		await editor.page.keyboard.press('End');
		await editor.typeSlowly(' A');

		// No waitForTimeout — switch focus before the 250ms debounce fires.
		const secondItem = editor.page.locator('[contenteditable="true"]', { hasText: 'item two' });
		await secondItem.click();
		await editor.page.keyboard.press('End');
		await editor.typeSlowly(' B');
		await editor.bridge.waitForSourceContains('item two B');
		await editor.waitForUndoBatchFlush();

		await editor.undo();
		await editor.bridge.waitForSourceNotContains(' B');
		expect((await editor.bridge.getSource()).includes(' B')).toBe(false);
		expect((await editor.bridge.getSource()).includes(' A')).toBe(true);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
	});
});
