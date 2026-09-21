import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

/**
 * The insert toolbar (requirements/insert-toolbar.md): the demo routes' example of an app
 * calling insertMarkdown, driven with real clicks against the harness.
 */

const SNIPPET_ROWS = [
	{ name: 'rule', marker: '---' },
	{ name: 'code', marker: '```' },
	{ name: 'note', marker: ':::note' },
	{ name: 'math', marker: '$$' }
] as const;

test.describe('insert toolbar', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?insertToolbar=on');
		await editor.loadContent('start here\n\nsecond block\n');
	});

	test('buttons grey before a caret exists and enable after a real click', async ({ page }) => {
		const table = page.getByTestId('insert-table');
		await expect(table).toBeDisabled();

		await editor.clickBlock(0);
		await expect(table).toBeEnabled();
	});

	// Miss-analysis: the greying was only ever tested on the way to enabled, and no scenario
	// took focus out of the editor, so nothing noticed that a blur reported nothing.
	test('buttons grey again when focus leaves the editor', async ({ page }) => {
		const table = page.getByTestId('insert-table');
		await editor.clickBlock(0);
		await expect(table).toBeEnabled();

		// Part of the harness that cannot be selected: the browser's range survives this click,
		// the editor's caret does not.
		await page.locator('label').first().click();
		await expect(table).toBeDisabled();
	});

	test('the table button splices the canonical table at the caret', async ({ page }) => {
		await editor.focusBlock(0, 10);
		await page.getByTestId('insert-table').click();

		await editor.bridge.waitForSourceContains('| Column | Column |');
		await editor.bridge.waitForSourceContains('| --- | --- |');
	});

	for (const { name, marker } of SNIPPET_ROWS) {
		test(`the ${name} button lands its snippet in the source`, async ({ page }) => {
			await editor.focusBlock(0, 10);
			await page.getByTestId(`insert-${name}`).click();

			await editor.bridge.waitForSourceContains(marker);
		});
	}
});
