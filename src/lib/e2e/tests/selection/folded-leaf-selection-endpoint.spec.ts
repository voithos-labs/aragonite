import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';

/**
 * A folded render-primary leaf (block math) that is the range-START endpoint of a
 * cross-block sweep paints its own full-block endpoint box — the leaf-tier mirror
 * of the childless-container case pinned in plugins/mermaid-selection-overlay
 * (test 2). `createEditableLeaf.measurePartialRects` covers the rendered block box
 * while folded, so the endpoint rects paint where there is no source text node to
 * measure. Block math needs the latex plugin, so the harness is `/test/plugins`;
 * the concern (cross-block selection overlay) keeps this in the selection project.
 */

const MATH_BLOCK_ENDPOINT = "[data-block-path='[1]'] > .selection-overlay-endpoint";

test.describe('cross-block selection endpoint — folded render-primary leaf', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('mathblock');
		// Seed: Before / $$x^2$$ / After — settle the folded KaTeX render first.
		await expect(page.locator('.math-block-render .katex')).toHaveCount(1);
	});

	test('an upward sweep ending ON the folded math block paints its endpoint box', async ({
		page
	}) => {
		await editor.focusBlockEnd(2);
		await page.keyboard.press('Shift+ArrowUp');
		await page.keyboard.press('Shift+ArrowUp');
		await editor.waitForCrossBlock(true);

		// The folded leaf surfaces measurePartialRects, so as the range-start endpoint
		// it paints its own full box (endpoint rects, not the middle overlay).
		const endpoint = page.locator(MATH_BLOCK_ENDPOINT);
		await expect.poll(() => endpoint.count()).toBeGreaterThan(0);
		const box = await endpoint.first().boundingBox();
		expect(box!.width).toBeGreaterThan(0);
		expect(box!.height).toBeGreaterThan(0);
	});
});
