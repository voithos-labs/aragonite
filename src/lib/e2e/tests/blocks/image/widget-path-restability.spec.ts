import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Inserting a block ABOVE an image shifts its index without touching its raw, so the render memo
// skips a rebuild. The widget must not depend on a path baked at build time: click-to-select
// resolves the paragraph from that path, and a stale one resolves the wrong CST node and silently
// no-ops.
test.describe('image widget — click-select survives an index shift', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const overlay = (page: import('@playwright/test').Page) => page.locator('[data-image-overlay]');

	test('click still selects an image after a block is inserted above it', async ({ page }) => {
		await editor.loadContent('above\n\n![cat](/test-fixtures/sample.png)\n');

		// Enter at the end of block 0 moves the image from block [1] to block [2] without touching
		// its raw.
		await editor.focusBlockEnd(0);
		await page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(3);

		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
	});
});
