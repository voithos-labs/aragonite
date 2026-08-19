import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';
import { primaryModifier } from '../../../../platform';

test.describe('list marker — caret placement and typing', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Home then typing inserts at raw offset 0', async () => {
		await editor.loadContent('- Hello\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Hello' });
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.typeText('X');
		await editor.bridge.waitForSourceEquals('- XHello\n');
	});

	test('click in marker region lands cursor at raw offset 0', async () => {
		await editor.loadContent('- Hello\n');
		const marker = editor.page.locator(
			'.list-item-block [contenteditable="true"] > span.md-marker'
		);
		const box = await marker.boundingBox();
		if (!box) throw new Error('marker not visible');
		await editor.page.mouse.click(box.x + 1, box.y + box.height / 2);
		await editor.typeText('X');
		await editor.bridge.waitForSourceEquals('- XHello\n');
	});

	test('Ctrl+A selects content only, marker preserved on replace', async () => {
		await editor.loadContent('- Hello\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Hello' });
		await first.click();
		await editor.page.keyboard.press(`${primaryModifier}+KeyA`);

		const selectedText = await editor.page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selectedText).toBe('Hello');

		await editor.typeText('World');
		await editor.bridge.waitForSourceEquals('- World\n');
	});

	// Typing `- ` in an empty paragraph live-promotes to a list, and `focus(CURSOR_END)` on the new
	// ListBlock must clear the contenteditable="false" marker text node — a caret clamped onto its
	// end has every following keystroke silently dropped by the browser.
	test('typing after live-promote of empty paragraph lands caret in editable area', async () => {
		await editor.loadContent('\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.type('- ');
		await editor.page.keyboard.type('a');
		await editor.bridge.waitForSourceContains('- a');
	});

	test('multi-digit ordered marker cursor math works', async () => {
		await editor.loadContent(
			'1. one\n2. two\n3. three\n4. four\n5. five\n6. six\n7. seven\n8. eight\n9. nine\n10. ten\n'
		);
		const tenth = editor.page.locator('[contenteditable="true"]', { hasText: 'ten' });
		await tenth.click();
		await editor.page.keyboard.press('Home');
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('10. Xten');
	});
});
