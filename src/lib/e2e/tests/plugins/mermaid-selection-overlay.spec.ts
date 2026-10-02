import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import { STANDARD_DIAGRAM_DOC } from './mermaid-helpers';

/**
 * The cross-block selection overlay over containers with no children
 * (requirements/plugins/mermaid-selection-overlay.md): a mermaid block in a range has no child
 * hosts, so the block takes the whole-block overlay, rendered or in its error state. Only plugin
 * kinds have no children, hence the plugins project; the built-in case is
 * selection/overlay.spec.ts.
 */

const BROKEN_DOC = 'Above text\n\n```mermaid\nnotadiagram broken\n```\n\ntail text\n';
const CALLOUT_DOC = 'before\n\n:::callout Title\nBody\n:::\n\nafter\n';

const MIDDLE_OVERLAY = "[data-block-path='[1]'] > .selection-overlay-middle";

test.describe('cross-block selection overlay: childless opaque container', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('mermaid');
	});

	test('a keyboard sweep across a rendered diagram paints its full-block overlay', async ({
		page
	}) => {
		await editor.loadContent(STANDARD_DIAGRAM_DOC);
		await expect(page.locator('.mermaid-viewport svg')).toHaveCount(1, { timeout: 30_000 });

		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await expect(page.locator(MIDDLE_OVERLAY)).toHaveCount(1);
	});

	test('an upward sweep ending on the diagram paints its full-block overlay', async ({ page }) => {
		await editor.loadContent(STANDARD_DIAGRAM_DOC);
		await expect(page.locator('.mermaid-viewport svg')).toHaveCount(1, { timeout: 30_000 });

		await editor.focusBlockEnd(2);
		await page.keyboard.press('Shift+ArrowUp');
		await page.keyboard.press('Shift+ArrowUp');
		await editor.waitForCrossBlock(true);

		// The range holds the diagram whole, so it paints one box, as it does strictly inside.
		await expect(page.locator(MIDDLE_OVERLAY)).toHaveCount(1);
		const box = await page.locator(MIDDLE_OVERLAY).boundingBox();
		expect(box!.width).toBeGreaterThan(0);
		expect(box!.height).toBeGreaterThan(0);
	});

	test('the sweep paints the overlay on a broken diagram too (error state)', async ({ page }) => {
		await editor.loadContent(BROKEN_DOC);
		await expect(page.locator('.mermaid-error')).toBeVisible({ timeout: 30_000 });

		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await expect(page.locator(MIDDLE_OVERLAY)).toHaveCount(1);
	});

	test('a child-bearing opaque container (callout) held whole paints one box', async ({ page }) => {
		await editor.loadContent(CALLOUT_DOC);
		await editor.focusBlockStart(0);
		await page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);

		await expect(page.locator(MIDDLE_OVERLAY)).toHaveCount(1);
		await expect(
			page.locator("[data-block-path='[1]'] [data-block-path] .selection-overlay")
		).toHaveCount(0);
	});
});
