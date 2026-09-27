import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

const NBSP = ' ';

test.describe('a non-breaking space is content', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter after a quote paragraph holding only a non-breaking space stays in the quote', async () => {
		const source = `> a\n>\n> ${NBSP}\n`;
		await editor.loadContent(source);
		await editor.page.locator('[contenteditable="true"]', { hasText: 'a' }).first().click();
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');

		await editor.bridge.waitForSource((s) => s !== source);
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.bridge.getBlockKind(0)).toBe('blockquote');
		expect(await editor.bridge.getSource()).toContain(`> ${NBSP}\n`);
	});

	test('Enter after a list item holding only a non-breaking space starts the next item', async () => {
		await editor.loadContent(`- ${NBSP}\n`);
		await editor.page.locator('.list-item-block [contenteditable="true"]').first().click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');

		await editor.waitForListItemCount(2);
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.bridge.getSource()).toContain(`- ${NBSP}\n`);
	});
});
