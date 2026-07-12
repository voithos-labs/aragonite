import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/**
 * KaTeX `htmlAndMathml` output is two sibling trees inside `.katex`: the visual
 * `.katex-html` render and a `.katex-mathml` accessibility tree that
 * `katex/dist/katex.min.css` collapses to a 1px box. Without that stylesheet both
 * halves lay out, so every equation paints twice — the render followed by its TeX
 * source echoed as plain text. These pin "the widget renders once": the MathML
 * half occupies no visible box while the HTML half keeps its glyph layout.
 */

// Post-clip the MathML box is 1×1; unclipped it lays out at glyph size (tens of px).
const CLIPPED_PX = 2;

test.describe('plugin math rendering: single visible render', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
	});

	test('inline math paints once — the MathML half is clipped, the HTML half is not', async () => {
		await editor.gotoPlugins('math');
		const widget = editor.page.locator('.math-inline-widget');
		await expect(widget.locator('.katex-html')).toHaveCount(1);

		const mathmlBox = await widget.locator('.katex-mathml').boundingBox();
		const htmlBox = await widget.locator('.katex-html').boundingBox();
		expect(mathmlBox).not.toBeNull();
		expect(htmlBox).not.toBeNull();
		expect(mathmlBox!.width).toBeLessThanOrEqual(CLIPPED_PX);
		expect(mathmlBox!.height).toBeLessThanOrEqual(CLIPPED_PX);
		expect(htmlBox!.width).toBeGreaterThan(CLIPPED_PX);
	});

	test('block math paints once on the display-mode path', async () => {
		await editor.gotoPlugins('mathblock');
		const render = editor.page.locator('.math-block-render');
		await expect(render.locator('.katex-html')).toHaveCount(1);

		const mathmlBox = await render.locator('.katex-mathml').boundingBox();
		const htmlBox = await render.locator('.katex-html').boundingBox();
		expect(mathmlBox).not.toBeNull();
		expect(htmlBox).not.toBeNull();
		expect(mathmlBox!.width).toBeLessThanOrEqual(CLIPPED_PX);
		expect(mathmlBox!.height).toBeLessThanOrEqual(CLIPPED_PX);
		expect(htmlBox!.width).toBeGreaterThan(CLIPPED_PX);
	});
});
