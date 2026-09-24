import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { clickBlockSettled, enterPresentationMode } from './helpers';

// A pending mark in a paragraph holding a reference link: the rewrite's check reads the block
// with the document's link definitions, the way the block is drawn.
// Requirements: e2e/requirements/presentation/presentation-live-pending-marks-reference.md.

const DOC = 'see [text][ref] here\n\n[ref]: https://x.com\n';

test.describe('live mode: a pending mark beside a reference link', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', DOC);
	});

	test('Mod+B then a keystroke after the link writes a bold byte', async ({ page }) => {
		await clickBlockSettled(ep, 0);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();

		await page.keyboard.press('ControlOrMeta+b');
		await page.keyboard.type('y');
		await ep.bridge.waitForSourceContains('here**y**');

		expect(await ep.bridge.getSource()).toBe('see [text][ref] here**y**\n\n[ref]: https://x.com\n');
		await expect(page.locator('.text-editable-block strong').first()).toHaveText('y');
	});
});
