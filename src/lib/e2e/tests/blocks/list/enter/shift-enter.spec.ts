import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

// Shift+Enter inside a list item is a hard break, not a new item: the bytes gain the `\`
// line break and the item paints a second line the next keys land on.
// Requirements: e2e/requirements/blocks/list/enter/shift-enter.md.

/** How many distinct lines the element's text paints on. */
async function paintedLines(editor: EditorPage, selector: string): Promise<number> {
	return editor.page
		.locator(selector)
		.first()
		.evaluate((el) => {
			const range = document.createRange();
			range.selectNodeContents(el);
			const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
			return tops.size;
		});
}

test.describe('list item: Shift+Enter', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paints a real new line inside the item, and the next keys type on it', async ({ page }) => {
		await editor.loadContent('- item\n');
		await editor.focusBlockAtPath([0, 0, 0], 4);
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('more');
		await editor.bridge.waitForSourceContains('more');

		const src = await editor.bridge.getSource();
		expect(src).toMatch(/^- item\\\n\s*more\n$/);
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await paintedLines(editor, '.list-item-block .paragraph-block')).toBe(2);
	});
});
