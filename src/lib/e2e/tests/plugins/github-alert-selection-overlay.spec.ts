import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/**
 * A GitHub alert swept into a cross-block range (requirements/plugins/github-alert-selection-
 * overlay.md). Its title row is chrome derived from the `[!WARNING]` marker, with no child
 * block-host to paint it, so the block the range holds whole must take one box over everything
 * it renders.
 */

const ALERT_DOC = 'above\n\n> [!WARNING]\n> body line\n\nbelow\n';
const ALERT_OVERLAY = "[data-block-path='[1]'] > .selection-overlay-middle";

test.describe('cross-block selection overlay - a GitHub alert held whole', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('admonitions');
		await editor.loadContent(ALERT_DOC);
	});

	test('the painted box covers the title row, not just the body', async ({ page }) => {
		await editor.focusBlockStart(0);
		await page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);

		const overlay = page.locator(ALERT_OVERLAY);
		await expect(overlay).toHaveCount(1);

		const box = (await overlay.boundingBox())!;
		const title = (await page.locator('.admonition-title').boundingBox())!;
		expect(title.height).toBeGreaterThan(0);
		expect(title.y).toBeGreaterThanOrEqual(box.y - 1);
		expect(title.y + title.height).toBeLessThanOrEqual(box.y + box.height + 1);
	});

	test('the body block inside it paints nothing, so the highlight never doubles', async ({
		page
	}) => {
		await editor.focusBlockStart(0);
		await page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);

		await expect(page.locator(ALERT_OVERLAY)).toHaveCount(1);
		await expect(
			page.locator("[data-block-path='[1]'] [data-block-path] .selection-overlay")
		).toHaveCount(0);
	});

	// The range cuts through the alert, so no one box can stand for it: its body block paints its
	// own endpoint rects and the title row stays unpainted.
	test('a range ENDING inside the alert leaves the box to the body block', async ({ page }) => {
		await editor.focusBlockStart(0);
		await editor.shiftClickBlock([1, 0], 4);
		await editor.waitForCrossBlock(true);

		await expect(page.locator(ALERT_OVERLAY)).toHaveCount(0);
		await expect(
			page.locator("[data-block-path='[1,0]'] .selection-overlay-endpoint")
		).not.toHaveCount(0);
	});
});
