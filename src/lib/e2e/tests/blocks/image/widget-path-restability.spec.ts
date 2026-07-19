import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Inserting a block ABOVE an image shifts the image block's index without
// touching its raw, so the render memo skips a rebuild. The image widget must
// not depend on a path baked at build time: click-to-select resolves the
// paragraph from the widget's path, and a stale one resolves the wrong CST
// node and silently no-ops. Regression for the paste+undo+scroll repro, reduced
// to its general form (a single net index shift, no windowing required).
test.describe('image widget — click-select survives an index shift', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const overlay = (page: import('@playwright/test').Page) => page.locator('[data-image-overlay]');

	test('click still selects an image after a block is inserted above it', async ({ page }) => {
		await editor.loadContent('above\n\n![cat](/test-fixtures/sample.png)\n');

		// Insert an empty block above the image (Enter at end of block 0). The
		// image moves from block [1] to block [2]; its raw is untouched.
		await editor.focusBlockEnd(0);
		await page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(3);

		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
	});
});
