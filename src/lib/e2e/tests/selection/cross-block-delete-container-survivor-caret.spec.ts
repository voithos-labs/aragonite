import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

const TABLE_2x3 = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

// A container survivor must be DESCENDED to its deepest leaf's end: a char offset on the
// container's own path names bytes no leaf owns, and the restore mis-lands.
test.describe('cross-block delete: container survivor caret', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('two consumed tables land the caret in the preceding blockquote last leaf', async ({
		page
	}) => {
		await editor.loadContent(`> alpha\n>\n> bravo\n\n${TABLE_2x3}\n${TABLE_2x3}`);

		// Select from the first cell of the first table through document end, so both
		// tables are fully consumed and the blockquote is the only survivor.
		await page.locator('[role="cell"]').first().click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| --- | --- |');

		// The typed char must land at the end of the blockquote's last leaf, proving
		// the survivor descended into the leaf rather than parking on the container
		// path (where it would clamp to the block start or the wrong leaf).
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('bravoX');

		const source = await editor.bridge.getSource();
		expect(source).toContain('> bravoX');
		expect(source).toContain('> alpha');
		expect(source).not.toContain('| --- | --- |');
	});
});
