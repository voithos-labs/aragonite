import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Requirements: `e2e/requirements/blocks/list/tab-indent.md`.

test.describe('a tab in a list item’s indentation', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const source of ['- a\n\n\tb\n', '- a\n\n  \tb\n']) {
		test(`${JSON.stringify(source)} loads as one item with two paragraphs`, async ({ page }) => {
			await editor.loadContent(source);

			expect(await editor.bridge.getBlockCount()).toBe(1);
			expect(await editor.bridge.getBlockKind(0)).toBe('list');
			await expect(page.locator('[data-block-kind="indentedCode"]')).toHaveCount(0);
		});
	}

	test('typing in the item keeps its two paragraphs', async ({ page }) => {
		await editor.loadContent('- a\n\n  \tb\n');
		await editor.focusBlockAtPath([0, 0, 0], 1);

		await page.keyboard.type('x');

		await editor.bridge.waitForSourceContains('x');
		expect(await editor.bridge.getSource()).toBe('- ax\n\n    b\n');
		expect(await editor.parseConverged()).toBe(true);
	});
});
