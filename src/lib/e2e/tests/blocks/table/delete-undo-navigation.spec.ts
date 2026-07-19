import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

const FIXTURE = `Above paragraph.

| A | B | C |
| --- | --- | --- |
| 1 | 2 | 3 |
| 4 | 5 | 6 |

Below paragraph.
`;

test.describe('table block: delete + undo + arrow navigation', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(FIXTURE);
	});

	test('after delete-table-then-undo, ArrowDown from above can enter the table', async ({
		page
	}) => {
		// Three Ctrl+A presses: cell, table (cross-block intra-table), document.
		// Two presses gets us the table-coverage selection that Backspace deletes.
		await page.locator('[role="cell"]').nth(4).click();
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Control+a');
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('| A | B | C |');

		await editor.undo();
		await editor.bridge.waitForSourceContains('| A | B | C |');

		// Click into the paragraph above and ArrowDown into the restored table.
		await page.locator('[contenteditable="true"]', { hasText: 'Above paragraph' }).click();
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.type('X');

		const after = await editor.bridge.getSource();
		// X must land somewhere inside the table — header or body. ArrowDown from
		// above with sticky-X lands at row 0 (header) per `focusAtColumn`.
		const cells = ['A', 'B', 'C', '1', '2', '3', '4', '5', '6'];
		const hitTable = cells.some((c) => after.includes(`| X${c}`) || after.includes(`| ${c}X`));
		expect(hitTable, `Expected X in some table cell. Got source:\n${after}`).toBe(true);
	});
});
