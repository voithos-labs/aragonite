import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

// The prose right-click menu carries an "Insert block" flyout: the same empty blocks the tail's
// `+` offers, minted as a sibling after the block under the pointer. Only top-level prose has it —
// inside a table cell, a code fence or a nested block the row is absent, since a sibling there
// would not be what the user meant. The source bytes are the oracle.
// Requirements: e2e/requirements/context-menu-insert.md.

test.describe('right-click menu: Insert block', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('picking Code block from the flyout mints an empty fence after the paragraph', async ({
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

	test('a nested block and a table cell get no Insert block row', async ({ page }) => {
		await editor.loadContent('- item text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		await page.getByText('item text').click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: 'Insert block' })).toHaveCount(0);
		await page.keyboard.press('Escape');

		await page.locator('[role="cell"]').nth(2).click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: /delete row/i })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: 'Insert block' })).toHaveCount(0);
	});
});
