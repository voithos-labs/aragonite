import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

// The right-click menu on prose carries an "Insert block" flyout, the one place empty blocks are
// added from, and they land after the block under the pointer. Only top-level prose has it, since
// inside a table cell, a code fence or a nested block a sibling is not what the user meant, so the
// row is absent there. The source bytes are what is checked.
// Requirements: e2e/requirements/context-menu-insert.md.

test.describe('right-click menu: Insert block', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('picking Code block from the flyout creates an empty fence after the paragraph', async ({
		page
	}) => {
		await editor.loadContent('first\n\nsecond\n');
		await page.getByText('first').click({ button: 'right' });
		const row = page.getByRole('menuitem', { name: 'Insert block' });
		await expect(row).toBeVisible();
		await row.hover();
		await page.getByRole('menuitem', { name: 'Code block' }).click();

		await editor.bridge.waitForSourceContains('```');
		expect(await editor.bridge.getSource()).toBe('first\n\n```\n\n```\n\nsecond\n');
	});

	test('one Ctrl+Z takes the inserted block and its paragraph back together', async ({ page }) => {
		const before = 'first\n\nsecond\n';
		await editor.loadContent(before);
		await page.getByText('first').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Insert block' }).hover();
		await page.getByRole('menuitem', { name: 'Code block' }).click();
		await editor.bridge.waitForSourceEquals('first\n\n```\n\n```\n\nsecond\n');
		await editor.waitForRenderFlush();

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
	});

	test('a nested block and a table cell get no Insert block row', async ({ page }) => {
		await editor.loadContent('- item text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		await page.getByText('item text').click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: 'Insert block' })).toHaveCount(0);
		await page.keyboard.press('Escape');

		await page.locator('.table-cell').nth(2).click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: /delete row/i })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: 'Insert block' })).toHaveCount(0);
	});
});
