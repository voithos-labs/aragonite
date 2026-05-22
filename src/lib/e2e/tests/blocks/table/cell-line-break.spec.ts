import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

const TABLE_1COL = '| H |\n| :- |\n| Left |\n';

test.describe('table cell Shift+Enter inserts <br>', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+Enter splits cell content with <br>; source preserves the tag', async ({ page }) => {
		await editor.loadContent(TABLE_1COL);
		// Focus the data cell (header is nth(0), data is nth(1) for a 1-column table).
		await page.locator('[role="cell"]').nth(1).click();
		// Move caret to end of "Left" before pressing Shift+Enter.
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+Enter');
		await editor.typeText('Right');

		await editor.bridge.waitForSourceContains('Left<br>Right');
		expect(await editor.bridge.getSource()).toContain('| Left<br>Right |');
	});

	// Visible line-break rendering in cells depends on a cell-inline-render
	// migration (deferred — see docs/issues.md). The current ship is byte-level:
	// the <br> tag lands in the source; the cell displays it as literal text
	// until cells switch to using the inline-render pipeline.
});
