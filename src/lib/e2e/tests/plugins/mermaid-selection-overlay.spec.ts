import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import { STANDARD_DIAGRAM_DOC } from './mermaid-helpers';

/**
 * Cross-block selection overlay over childless opaque containers
 * (requirements/plugins/mermaid-selection-overlay.md). A mermaid block swept into a cross-block
 * range has no child block-hosts to paint highlights, so the block itself must take the full-block
 * overlay — in the rendered AND the error state — while child-bearing containers keep delegating to
 * their children (no double paint). Lives in the plugins project because only plugin kinds produce
 * childless containers; the built-in overlay behavior is pinned in tests/selection/overlay.spec.ts.
 */

const BROKEN_DOC = 'Above text\n\n```mermaid\nnotadiagram broken\n```\n\ntail text\n';
const CALLOUT_DOC = 'before\n\n:::callout Title\nBody\n:::\n\nafter\n';

const MIDDLE_OVERLAY = "[data-block-path='[1]'] > .selection-overlay-middle";

test.describe('cross-block selection overlay — childless opaque container', () => {
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

	test('an upward sweep ending ON the diagram paints its endpoint box', async ({ page }) => {
		await editor.loadContent(STANDARD_DIAGRAM_DOC);
		await expect(page.locator('.mermaid-viewport svg')).toHaveCount(1, { timeout: 30_000 });

		await editor.focusBlockEnd(2);
		await page.keyboard.press('Shift+ArrowUp');
		await page.keyboard.press('Shift+ArrowUp');
		await editor.waitForCrossBlock(true);

		// The container surfaces measurePartialRects, so as the range-start endpoint
		// it paints its own full box (endpoint rects, not the middle overlay).
		const endpoint = page.locator("[data-block-path='[1]'] > .selection-overlay-endpoint");
		await expect.poll(() => endpoint.count()).toBeGreaterThan(0);
		const box = await endpoint.first().boundingBox();
		expect(box!.width).toBeGreaterThan(0);
		expect(box!.height).toBeGreaterThan(0);
	});

	test('the sweep paints the overlay on a BROKEN diagram too (error state)', async ({ page }) => {
		await editor.loadContent(BROKEN_DOC);
		await expect(page.locator('.mermaid-error')).toBeVisible({ timeout: 30_000 });

		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await expect(page.locator(MIDDLE_OVERLAY)).toHaveCount(1);
	});

	test('a child-bearing opaque container (callout) still delegates painting to its children', async ({
		page
	}) => {
		await editor.loadContent(CALLOUT_DOC);
		await editor.focusBlockStart(0);
		await page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		await expect(page.locator(MIDDLE_OVERLAY)).toHaveCount(0);
		await expect(
			page.locator("[data-block-path='[1]'] [data-block-path] .selection-overlay-middle")
		).not.toHaveCount(0);
	});
});
