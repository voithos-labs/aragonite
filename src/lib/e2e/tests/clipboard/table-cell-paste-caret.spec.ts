import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

const TABLE_2BODY = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

// A structural paste into a table cell splits the table at the paste row and
// splices the pasted blocks between the halves. Focus must land at the end of
// the LAST pasted block (the editor's "end of the pasted content" contract),
// never the first — the divergence this pins landed the caret on the first block.
test.describe('table cell paste: caret at end of pasted content', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await page.evaluate(() => navigator.clipboard.writeText(''));
	});

	test('multi-block paste focuses the last pasted block, not the first', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(2).click();
		await page.evaluate(() => navigator.clipboard.writeText('Para one.\n\n## Two\n'));
		await page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('## Two');

		// Splits into [halfA, "Para one.", "## Two", halfB]. Typing must land at the
		// end of "## Two", not "Para one.".
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('## TwoX');

		const src = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(src).toContain('## TwoX');
		expect(src).toContain('Para one.');
		expect(src).not.toContain('Para one.X');
	});
});
