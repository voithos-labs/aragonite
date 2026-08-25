import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

/**
 * Insert toolbar (requirements/insert-toolbar.md): the demo routes' consumer-side
 * insertMarkdown example, driven with real clicks against the harness mount.
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

	// Miss-analysis: the greying was only ever driven towards enabled — no scenario took focus
	// OUT of the editor, so the channel's silence on a user blur went unobserved.
	test('buttons grey again when focus leaves the editor', async ({ page }) => {
		const table = page.getByTestId('insert-table');
		await editor.clickBlock(0);
		await expect(table).toBeEnabled();

		// Non-selectable harness chrome: the native range survives this click, the caret does not.
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
