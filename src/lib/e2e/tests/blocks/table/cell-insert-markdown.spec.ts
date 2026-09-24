import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Markdown inserted with the caret in a table cell lands as blocks after the table, and the
// document it leaves reloads as the blocks on screen.
test.describe('table block: inserting markdown from a cell', () => {
	const TABLE = '| a | b |\n| --- | --- |\n| c |  |\n';

	for (const [markdown, quote] of [
		['> ', '> \n'],
		['> quoted\n', '> quoted\n']
	]) {
		test(`${JSON.stringify(markdown)} from the empty cell reloads as a quote after the table`, async ({
			page
		}) => {
			const editor = new EditorPage(page);
			await editor.goto();
			await editor.loadContent(`${TABLE}\nAfter\n`);
			await page.locator('.table-cell').nth(3).click();

			await page.evaluate((md) => (window as any).__test.insertMarkdown(md), markdown);

			await editor.bridge.waitForSourceContains('>');
			expect(await editor.parseConverged()).toBe(true);
			expect(await editor.bridge.getSource()).toBe(`${TABLE}\n${quote}\nAfter\n`);
			await expect(page.locator('.blockquote-block')).toHaveCount(1);
		});
	}
});
