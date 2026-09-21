import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';

/**
 * A render-primary leaf with its source hidden, as the range's start endpoint, paints its own
 * full-block box: the block-level mirror of the childless-container case in
 * `plugins/mermaid-selection-overlay`. `measurePartialRects` covers the rendered box, so
 * endpoint rects paint where there is no source text node to measure.
 */

const MATH_BLOCK_ENDPOINT = "[data-block-path='[1]'] > .selection-overlay-endpoint";

test.describe('cross-block selection endpoint: folded render-primary leaf', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('mathblock');
		// Seed: Before / $$x^2$$ / After. Wait for the KaTeX render first.
		await expect(page.locator('.math-block-render .katex')).toHaveCount(1);
	});

	test('an upward sweep ending on the folded math block paints its endpoint box', async ({
		page
	}) => {
		await editor.focusBlockEnd(2);
		await page.keyboard.press('Shift+ArrowUp');
		await page.keyboard.press('Shift+ArrowUp');
		await editor.waitForCrossBlock(true);

		// The leaf offers `measurePartialRects`, so as the range's start endpoint it paints
		// its own full box (endpoint rects, not the middle overlay).
		const endpoint = page.locator(MATH_BLOCK_ENDPOINT);
		await expect.poll(() => endpoint.count()).toBeGreaterThan(0);
		const box = await endpoint.first().boundingBox();
		expect(box!.width).toBeGreaterThan(0);
		expect(box!.height).toBeGreaterThan(0);
	});
});
