// Exactly one edit event per structural list-context op (Tab / Shift+Tab / Enter mid-item / Enter at end).
import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { countEditEvents } from './helpers';

test.describe('one edit event per op — indentItem', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Tab on list item emits exactly one edit event', async () => {
		await editor.loadContent('- Item 1\n- Item 2\n');
		const items = editor.page.locator('.list-item-block [contenteditable="true"]');
		await items.nth(1).click();

		const count = await countEditEvents(editor, async () => {
			await editor.page.keyboard.press('Tab');
			await editor.bridge.waitForSourceMatches(/^\s+- Item 2$/m);
		});

		expect(count).toBe(1);
	});
});

test.describe('one edit event per op — unindentItem', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+Tab on nested item emits exactly one edit event', async () => {
		await editor.loadContent('- Item 1\n  - Nested\n- Item 2\n');
		const nested = editor.page.locator(
			'.list-item-content .list-block .list-item-block [contenteditable="true"]'
		);
		await nested.first().click();

		const count = await countEditEvents(editor, async () => {
			await editor.page.keyboard.press('Shift+Tab');
			await editor.bridge.waitForSourceMatches(/^- Nested$/m);
		});

		expect(count).toBe(1);
	});
});

test.describe('one edit event per op — splitItemAtOffset', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter mid-item emits exactly one edit event', async () => {
		await editor.loadContent('- HelloWorld\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'HelloWorld' });
		await item.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('ArrowRight');

		const count = await countEditEvents(editor, async () => {
			await editor.page.keyboard.press('Enter');
			await editor.bridge.waitForSourceContains('- World');
		});

		expect(count).toBe(1);
	});
});

test.describe('one edit event per op — insertItemAfter', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at end of item emits exactly one edit event', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Alpha' });
		await first.click();
		await editor.page.keyboard.press('End');

		const count = await countEditEvents(editor, async () => {
			await editor.page.keyboard.press('Enter');
			await editor.bridge.waitForSourceMatches(/- Alpha\n[\s\S]+?- Beta/);
		});

		expect(count).toBe(1);
	});
});
