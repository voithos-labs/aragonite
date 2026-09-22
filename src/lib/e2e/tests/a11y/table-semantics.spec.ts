import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { expectNoNewA11yViolations } from '../../a11y/axe-helper';

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

test.describe('table structure for assistive tech', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
		await editor.waitForRenderFlush();
	});

	test('row 0 cells are column headers, body cells are cells', async ({ page }) => {
		const rows = page.locator('[role="table"] [role="row"]');
		await expect(rows).toHaveCount(3);
		await expect(rows.nth(0).getByRole('columnheader')).toHaveText(['A', 'B']);
		await expect(rows.nth(0).getByRole('cell')).toHaveCount(0);
		await expect(rows.nth(1).getByRole('cell')).toHaveText(['1', '2']);
		await expect(rows.nth(1).getByRole('columnheader')).toHaveCount(0);
	});

	test('a table document has no new violations', async ({ page }) => {
		await expectNoNewA11yViolations(page, 'table');
	});
});
