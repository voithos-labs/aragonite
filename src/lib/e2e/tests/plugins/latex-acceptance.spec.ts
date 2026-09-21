import { test, expect } from '../../fixtures';
import { PluginsPage, clickWidgetCenter, clickWidgetEnd } from './helpers';

/**
 * Acceptance coverage for the LaTeX extension, each test labelled with the spec's axis id. These
 * assert what only a real browser can prove: A1, showing the source holds the scroll, the geometry
 * and the caret; A2, one of several equations re-renders alone, with the memoizing itself pinned
 * in math-renderer.test.ts; A7, every multiline environment renders; A5, invalid maths shows a
 * readable message.
 */

// A pad tall enough that the block-math fixture scrolls in a default viewport, so the A1 "no
// view-jump" assertion measures a genuine scroll position, not a constant zero on a doc that never
// scrolls.
const PAD_ABOVE = Array.from({ length: 30 }, (_, i) => `Above padding line ${i}.`).join('\n\n');
const PAD_BELOW = Array.from({ length: 30 }, (_, i) => `Below padding line ${i}.`).join('\n\n');
const TALL_BLOCK_MATH = `${PAD_ABOVE}\n\n$$x^2$$\n\n${PAD_BELOW}\n`;
const INLINE_MATH = 'Before $x^2$ after\n\nNext\n';

// The LaTeX inside each multiline environment (A7). `\\` separates rows, and the dedicated "line
// breaks" row uses it where it means something, inside \substack, since a bare `\\` in display
// mode does nothing.
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

	/**
	 * Scroll the block-maths render to the middle of the viewport, so a height change from showing
	 * the source cannot push it off screen, which would force its own scroll and hide what is
	 * under test. Returns the scrollTop once it stops moving.
	 */
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
		await this.waitForScrollSettle();
		return this.editorScrollTop();
	}

	/**
	 * A height change reaches scrollTop through the batched measure pass, not through the render
	 * itself, so a fixed two-frame wait reads halfway once a loaded machine pushes that pass past
	 * it. Counted in frames, not milliseconds, so a slow machine waits proportionally.
	 */
	async waitForScrollSettle(): Promise<void> {
		await this.page.evaluate(async () => {
			const editor = document.querySelector('.editor') as HTMLElement;
			const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
			let last = editor.scrollTop;
			for (let held = 0, i = 0; held < 5 && i < 180; i++) {
				await frame();
				if (editor.scrollTop === last) held++;
				else {
					held = 0;
					last = editor.scrollTop;
				}
			}
		});
	}

	async editorScrollTop(): Promise<number> {
		return this.page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollTop);
	}

	async blockRenderTop(): Promise<number> {
		const box = await this.blockRender.boundingBox();
		if (!box) throw new Error('block render has no bounding box');
		return box.y;
	}

	/** What A2 reads per block: a `mountId` that stays the same, meaning no remount, and a `count`
	 *  that goes up each time the KaTeX render runs again. In document order. */
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

	// A1, showing and hiding a block's source: it must not jump the scroll position, the view jump
	// Obsidian documents, and must put the render back at exactly its previous geometry. Measured
	// on a fixture that scrolls, so the scroll assertion can actually fail.
	test('A1: block reveal→fold holds scroll position and render geometry', async ({ page }) => {
		await editor.loadContent(TALL_BLOCK_MATH);
		await expect(editor.blockRender).toHaveCount(1);

		const baselineScroll = await editor.centerBlockMathAndReadScroll();
		expect(baselineScroll).toBeGreaterThan(GEOMETRY_TOLERANCE);
		const renderTopBefore = await editor.blockRenderTop();

		// Showing the source: the source box is taller, but the scroll must hold.
		await clickWidgetCenter(editor.blockRender);
		await expect(editor.blockSource).toHaveCount(1);
		await editor.waitForScrollSettle();
		expect(Math.abs((await editor.editorScrollTop()) - baselineScroll)).toBeLessThanOrEqual(
			SCROLL_TOLERANCE
		);

		// Leave past the bottom edge, a view change with no edit: the scroll still holds and the
		// re-rendered display sits exactly where it started, with no net shift.
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowRight');
		await expect(editor.blockRender).toHaveCount(1);
		await editor.waitForScrollSettle();
		expect(Math.abs((await editor.editorScrollTop()) - baselineScroll)).toBeLessThanOrEqual(
			SCROLL_TOLERANCE
		);
		expect(Math.abs((await editor.blockRenderTop()) - renderTopBefore)).toBeLessThanOrEqual(
			GEOMETRY_TOLERANCE
		);
	});

	// A1 for an inline formula: the caret survives showing the source and committing, so a
	// character typed after the commit lands past the widget rather than at a block edge, and the
	// block below does not move vertically across the round trip.
	test('A1: inline reveal→edit→commit preserves the caret with no vertical shift', async ({
		page
	}) => {
		await editor.loadContent(INLINE_MATH);
		await expect(editor.inlineWidget).toHaveCount(1);
		const nextTopBefore = (await editor.getBlock(1).boundingBox())?.y ?? NaN;

		// Clicked at the formula's end, so the typed byte continues it: the caret follows the
		// point (`latex-inline-click-caret.md`), and this test is about the commit, not the caret.
		await clickWidgetEnd(editor.inlineWidget);
		await expect(editor.inlineWidget).toHaveCount(0);
		await page.keyboard.type('z');
		// Moving the caret out is what commits; Enter splits the block instead.
		await page.keyboard.press('End');
		await expect(editor.inlineWidget).toHaveCount(1);

		// The commit left the caret at the widget's trailing edge, so the next character lands
		// right after it, showing the caret survived the re-render.
		await page.keyboard.type('!');
		await editor.bridge.waitForSourceContains('$x^2z$! after');
		expect(await editor.bridge.getSource()).toContain('Before $x^2z$! after');

		const nextTopAfter = (await editor.getBlock(1).boundingBox())?.y ?? NaN;
		expect(Math.abs(nextTopAfter - nextTopBefore)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
	});

	// A2: editing one of several live block equations re-renders only that one. The memoizing is
	// proven in the unit suite; this ties it to the live document, where the worry is KaTeX work
	// repeated on untouched blocks. The formulas differ so a stray render elsewhere is obvious,
	// and paragraphs sit between the equations so blurring the edited one commits to a paragraph
	// rather than opening a neighbour.
	test('A2: editing one block equation re-renders only that equation', async ({ page }) => {
		await editor.loadContent(
			'Para 0.\n\n$$a^2$$\n\nPara 1.\n\n$$b^2$$\n\nPara 2.\n\n$$c^2$$\n\nPara 3.\n'
		);
		await expect(editor.blockRender).toHaveCount(3);
		await editor.waitForRenderFlush();

		const before = await editor.renderMarkers();
		expect(new Set(before.map((m) => m.mountId)).size).toBe(3); // three distinct instances

		// Open only the middle equation, insert inside its fence, then commit by blurring to a
		// paragraph; getBlock(4) is "Para 2.".
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
		// The edited equation: the same instance, so no remount, but it did re-render.
		expect(after[1].mountId).toBe(before[1].mountId);
		expect(Number(after[1].count)).toBeGreaterThan(Number(before[1].count));
	});

	// A7: every multiline environment renders KaTeX with no error node. Table-driven, so a gap in
	// any one environment fails only its own row.
	for (const [name, inner] of A7_ENVIRONMENTS) {
		test(`A7: ${name} renders as display math`, async () => {
			await editor.loadContent(`$$\n${inner}\n$$\n`);
			await expect(editor.blockRender).toHaveCount(1);
			await expect(editor.blockRender.locator('.katex')).toHaveCount(1);
			await expect(editor.page.locator('.math-error')).toHaveCount(0);
			await expect(editor.page.locator('.katex-error')).toHaveCount(0);
		});
	}

	// A5: invalid maths renders a readable inline message through the live widget path, never
	// KaTeX's raw `.katex-error` strip. Swapping the adapter is proven in the unit suite; this
	// ties it to the render the user actually sees.
	test('A5: invalid inline math shows a legible error, not a raw strip', async () => {
		await editor.loadContent('Before $\\frac{$ after\n');
		await expect(editor.inlineWidget).toHaveCount(1);

		const errorNode = editor.inlineWidget.locator('.math-error');
		await expect(errorNode).toHaveCount(1);
		// The source itself, painted as an error, with the parser's message in the hover title.
		expect((await errorNode.getAttribute('title'))?.toLowerCase()).toContain('error');
		await expect(editor.page.locator('.katex-error')).toHaveCount(0);
	});
});
