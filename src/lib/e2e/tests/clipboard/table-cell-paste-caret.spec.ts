import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

const TABLE_2BODY = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

// A structural paste into a cell splits the table at the paste row. Focus must land at the
// end of the LAST pasted block, the editor's "end of the pasted content" contract.
test.describe('table cell paste: caret at end of pasted content', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.seedClipboard('');
	});

	test('multi-block paste focuses the last pasted block, not the first', async ({ page }) => {
		await editor.loadContent(TABLE_2BODY);
		await page.locator('[role="cell"]').nth(2).click();
		await editor.seedClipboard('Para one.\n\n## Two\n');
		await editor.paste();
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
