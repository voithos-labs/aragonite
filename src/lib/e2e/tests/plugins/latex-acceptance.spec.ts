import { test, expect } from '../../fixtures';
import { PluginsPage, clickWidgetCenter } from './helpers';

/**
 * Acceptance-axis coverage for the LaTeX extension, each test labelled with the
 * spec's axis id. These assert the differentiators that only a real browser can
 * prove: A1 (reveal transition holds scroll + geometry + caret), A2 (editing one
 * of N live equations re-renders only that one), A7 (every multiline environment
 * renders), A5 (invalid math shows a legible message, not KaTeX's raw strip). The
 * A2 memo primitive is also unit-pinned (math-renderer.test.ts); this file adds the
 * live edit-one-of-N pin. Round-trip (A11) is unit-covered; not re-tested here.
 *
 * A1 flakiness watch: the block-reveal fixture is tall enough that folding a block
 * can trip a windowing geometry re-estimate. Read an A1 failure here as a
 * windowing-geometry interaction FIRST, before suspecting a reveal regression.
 */

// A pad tall enough that the block-math fixture scrolls in a default viewport, so
// the A1 "no view-jump" assertion measures a genuine scroll position, not a
// constant zero on a doc that never scrolls.
const PAD_ABOVE = Array.from({ length: 30 }, (_, i) => `Above padding line ${i}.`).join('\n\n');
const PAD_BELOW = Array.from({ length: 30 }, (_, i) => `Below padding line ${i}.`).join('\n\n');
const TALL_BLOCK_MATH = `${PAD_ABOVE}\n\n$$x^2$$\n\n${PAD_BELOW}\n`;
const INLINE_MATH = 'Before $x^2$ after\n\nNext\n';

// Inner LaTeX per multiline environment (A7). `\\` is the row separator; the
// dedicated "line breaks" row exercises `\\` where it is meaningful (\substack),
// since a bare `\\` in display mode is inert.
const A7_ENVIRONMENTS: Array<[name: string, inner: string]> = [
	['aligned', '\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}'],
	['cases', 'f(x) = \\begin{cases}\n1 & x > 0 \\\\\n0 & x \\le 0\n\\end{cases}'],
	['align*', '\\begin{align*}\na &= b \\\\\nc &= d\n\\end{align*}'],
	['array', '\\begin{array}{cc}\na & b \\\\\nc & d\n\\end{array}'],
	['matrix', '\\begin{matrix}\na & b \\\\\nc & d\n\\end{matrix}'],
	['gather', '\\begin{gather}\na = b \\\\\nc = d\n\\end{gather}'],
	['line breaks', '\\sum_{\\substack{a \\\\ b}} x']
];

const SCROLL_TOLERANCE = 2;
const GEOMETRY_TOLERANCE = 2;

class AcceptancePage extends PluginsPage {
	get blockRender() {
		return this.page.locator('.math-block-render');
	}

	get blockSource() {
		return this.page.locator('.math-block-source');
	}

	get inlineWidget() {
		return this.page.locator('.math-inline-widget');
	}

	/** Scroll the block-math render to the viewport's vertical middle, so a reveal-
	 *  driven height change can't push it off-screen (which would force its own
	 *  scroll-into-view and mask the axis under test). Returns the settled scrollTop. */
	async centerBlockMathAndReadScroll(): Promise<number> {
		const scrollTop = await this.page.evaluate(() => {
			const editor = document.querySelector('.editor') as HTMLElement | null;
			const render = document.querySelector('.math-block-render');
			if (!editor || !render) return null;
			const er = editor.getBoundingClientRect();
			const rr = render.getBoundingClientRect();
			editor.scrollTop += rr.top - er.top - (editor.clientHeight - rr.height) / 2;
			return editor.scrollTop;
		});
		if (scrollTop === null) throw new Error('centerBlockMath: editor or render not found');
		await this.waitForRenderFlush();
		return this.editorScrollTop();
	}

	async editorScrollTop(): Promise<number> {
		return this.page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollTop);
	}

	async blockRenderTop(): Promise<number> {
		const box = await this.blockRender.boundingBox();
		if (!box) throw new Error('block render has no bounding box');
		return box.y;
	}

	/** Per-block render oracle (A2): stable `mountId` (no remount) + `count` bumped
	 *  each time the KaTeX render effect runs (a re-render). In document order. */
	async renderMarkers(): Promise<Array<{ mountId: string | null; count: string | null }>> {
		return this.blockRender.evaluateAll((els) =>
			els.map((el) => ({
				mountId: el.getAttribute('data-mount-id'),
				count: el.getAttribute('data-render-count')
			}))
		);
	}
}

test.describe('latex acceptance axes', () => {
	let editor: AcceptancePage;

	test.beforeEach(async ({ page }) => {
		editor = new AcceptancePage(page);
		await editor.gotoPlugins();
	});

	// A1 — block reveal transition: revealing then folding the block math must not
	// jump the scroll position (Obsidian's documented view-jump) and must return the
	// render to its exact prior geometry. Measured on a scrolling fixture so the
	// scroll assertion is falsifiable.
	test('A1: block reveal→fold holds scroll position and render geometry', async ({ page }) => {
		await editor.loadContent(TALL_BLOCK_MATH);
		await expect(editor.blockRender).toHaveCount(1);

		const baselineScroll = await editor.centerBlockMathAndReadScroll();
		expect(baselineScroll).toBeGreaterThan(GEOMETRY_TOLERANCE);
		const renderTopBefore = await editor.blockRenderTop();

		// Reveal: the source textbox is a taller affordance, but the scroll must hold.
		await clickWidgetCenter(editor.blockRender);
		await expect(editor.blockSource).toHaveCount(1);
		await editor.waitForRenderFlush();
		expect(Math.abs((await editor.editorScrollTop()) - baselineScroll)).toBeLessThanOrEqual(
			SCROLL_TOLERANCE
		);

		// Fold back out the bottom edge (pure view toggle, no edit): scroll still held,
		// and the re-rendered display sits exactly where it started — zero net shift.
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowRight');
		await expect(editor.blockRender).toHaveCount(1);
		await editor.waitForRenderFlush();
		expect(Math.abs((await editor.editorScrollTop()) - baselineScroll)).toBeLessThanOrEqual(
			SCROLL_TOLERANCE
		);
		expect(Math.abs((await editor.blockRenderTop()) - renderTopBefore)).toBeLessThanOrEqual(
			GEOMETRY_TOLERANCE
		);
	});

	// A1 — inline reveal transition: the caret survives reveal→commit (a char typed
	// after commit lands past the widget, not at a block edge) and the following
	// block does not shift vertically across the round-trip.
	test('A1: inline reveal→edit→commit preserves the caret with no vertical shift', async ({
		page
	}) => {
		await editor.loadContent(INLINE_MATH);
		await expect(editor.inlineWidget).toHaveCount(1);
		const nextTopBefore = (await editor.getBlock(1).boundingBox())?.y ?? NaN;

		await clickWidgetCenter(editor.inlineWidget);
		await expect(editor.inlineWidget).toHaveCount(0);
		await page.keyboard.type('z');
		await page.keyboard.press('Enter');
		await expect(editor.inlineWidget).toHaveCount(1);

		// Commit landed the caret at the widget's trailing edge — the next char lands
		// right after it, proving zero caret loss across the reactive re-render.
		await page.keyboard.type('!');
		await editor.bridge.waitForSourceContains('$x^2$! after');
		expect(await editor.bridge.getSource()).toContain('Before z$x^2$! after');

		const nextTopAfter = (await editor.getBlock(1).boundingBox())?.y ?? NaN;
		expect(Math.abs(nextTopAfter - nextTopBefore)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
	});

	// A2 — editing one of N live block equations re-renders only that one. The memo
	// primitive is unit-proven; this binds it to the live document, where the concern
	// is redundant KaTeX work across untouched blocks. Distinct formulas so a stray
	// cross-block render is unambiguous. Paragraphs separate the equations so blurring
	// the edited one commits to a paragraph, not by revealing a neighbouring block.
	test('A2: editing one block equation re-renders only that equation', async ({ page }) => {
		await editor.loadContent(
			'Para 0.\n\n$$a^2$$\n\nPara 1.\n\n$$b^2$$\n\nPara 2.\n\n$$c^2$$\n\nPara 3.\n'
		);
		await expect(editor.blockRender).toHaveCount(3);
		await editor.waitForRenderFlush();

		const before = await editor.renderMarkers();
		expect(new Set(before.map((m) => m.mountId)).size).toBe(3); // three distinct instances

		// Reveal only the MIDDLE equation, insert inside its fence, commit by blurring
		// to a paragraph (getBlock(4) is "Para 2.").
		await clickWidgetCenter(editor.blockRender.nth(1));
		await expect(editor.blockSource).toHaveCount(1);
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('z');
		await editor.getBlock(4).click();

		await editor.bridge.waitForSourceContains('$$zb^2$$');
		await expect(editor.blockRender).toHaveCount(3);
		await editor.waitForRenderFlush();

		const after = await editor.renderMarkers();
		// Untouched equations: same instance, zero extra renders.
		expect(after[0]).toEqual(before[0]);
		expect(after[2]).toEqual(before[2]);
		// Edited equation: same instance (no remount), but it DID re-render.
		expect(after[1].mountId).toBe(before[1].mountId);
		expect(Number(after[1].count)).toBeGreaterThan(Number(before[1].count));
	});

	// A7 — every multiline environment renders KaTeX with no error node. Table-driven
	// so a KaTeX coverage gap in any single environment fails only its own row.
	for (const [name, inner] of A7_ENVIRONMENTS) {
		test(`A7: ${name} renders as display math`, async () => {
			await editor.loadContent(`$$\n${inner}\n$$\n`);
			await expect(editor.blockRender).toHaveCount(1);
			await expect(editor.blockRender.locator('.katex')).toHaveCount(1);
			await expect(editor.page.locator('.math-error')).toHaveCount(0);
			await expect(editor.page.locator('.katex-error')).toHaveCount(0);
		});
	}

	// A5 — invalid math renders a legible inline message through the live widget-build
	// path, never KaTeX's raw `.katex-error` source strip. The adapter swap is unit-
	// proven; this binds it to the browser render the user actually sees.
	test('A5: invalid inline math shows a legible error, not a raw strip', async () => {
		await editor.loadContent('Before $\\frac{$ after\n');
		await expect(editor.inlineWidget).toHaveCount(1);

		const errorNode = editor.inlineWidget.locator('.math-error');
		await expect(errorNode).toHaveCount(1);
		expect((await errorNode.textContent())?.toLowerCase()).toContain('error');
		await expect(editor.page.locator('.katex-error')).toHaveCount(0);
	});
});
