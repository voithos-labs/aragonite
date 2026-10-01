import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Requirements: `e2e/requirements/blocks/list/indented-list-typing.md`.

const MODES = ['source', 'live'] as const;

test.describe('typing in an indented list', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const mode of MODES) {
		test(`the list keeps its indent and its two items (${mode})`, async ({ page }) => {
			await editor.setPresentationMode(mode);
			await editor.loadContent('  - a\n  - b\n');
			await editor.clickBlockAtPath([0, 0, 0], 0);
			await page.keyboard.press('End');

			await page.keyboard.type('Q');

			await expect.poll(() => editor.bridge.getSource()).toBe('  - aQ\n  - b\n');
			await editor.waitForListItemCount(2);
			expect(await editor.parseConverged()).toBe(true);
		});
	}
});
