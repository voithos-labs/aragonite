import { test, expect } from '../../fixtures';
import { MathRevealPage } from './latex-reveal-helpers';
import { edgeKey } from '../../platform-keys';

/**
 * Where a click on a rendered `$…$` widget puts the caret
 * (requirements/plugins/latex-inline-click-caret.md): the click reads as a place in the equation,
 * as it does on the block form, so editing a formula's start takes one click.
 */

const LONG_FORMULA = 'Before $alpha+beta$ after\n\nNext\n';

test.describe('inline math: a click puts the caret where it landed', () => {
	let editor: MathRevealPage;

	test.beforeEach(async ({ page }) => {
		editor = new MathRevealPage(page);
		await editor.gotoPlugins('math');
		await expect(editor.mathWidget).toHaveCount(1);
	});

	/** The painted glyph box; KaTeX's MathML copy is clipped to a pixel and measures nothing. */
	async function glyphBox(): Promise<{ x: number; y: number; width: number; height: number }> {
		const box = await editor.mathWidget.locator('.katex-html').first().boundingBox();
		if (!box) throw new Error('no glyph box for the rendered formula');
		return box;
	}

	/** Click at `x` across the glyph run, type one byte, then move out to commit it. */
	async function typeAtGlyphX(x: number, byte: string): Promise<string> {
		const box = await glyphBox();
		await editor.page.mouse.click(x, box.y + box.height / 2);
		await expect(editor.mathWidget).toHaveCount(0);

		await editor.page.keyboard.type(byte);
		await editor.page.keyboard.press(edgeKey('lineEnd'));
		await expect(editor.mathWidget).toHaveCount(1);
		return editor.bridge.getSource();
	}

	for (const mode of ['source', 'live'] as const) {
		test(`${mode} mode: a click at the left edge types into the head of the formula`, async () => {
			await editor.setPresentationMode(mode);
			const box = await glyphBox();

			expect(await typeAtGlyphX(box.x + 1, 'z')).toBe('Before $zx^2$ after\n\nNext\n');
		});

		test(`${mode} mode: a click at the right edge types onto the tail of the formula`, async () => {
			await editor.setPresentationMode(mode);
			const box = await glyphBox();

			expect(await typeAtGlyphX(box.x + box.width - 1, 'z')).toBe('Before $x^2z$ after\n\nNext\n');
		});
	}

	// A fraction's first glyph in the DOM isn't its first byte, so only a click at the widget's edge,
	// beside the ink, tells the formula's ends apart.
	for (const side of ['left', 'right'] as const) {
		test(`a click at the ${side} edge of a fraction types at that end of the formula`, async () => {
			const formula = String.raw`\frac{a}{b}+c`;
			await editor.loadContent(`Before $${formula}$ after\n\nNext\n`);
			await expect(editor.mathWidget).toHaveCount(1);
			const widget = (await editor.mathWidget.boundingBox())!;
			const x = side === 'left' ? widget.x + 1 : widget.x + widget.width - 1;
			const typed = side === 'left' ? `z${formula}` : `${formula}z`;

			expect(await typeAtGlyphX(x, 'z')).toBe(`Before $${typed}$ after\n\nNext\n`);
		});
	}

	test('a press further along the formula puts the caret at a later offset', async ({ page }) => {
		await editor.loadContent(LONG_FORMULA);
		await expect(editor.mathWidget).toHaveCount(1);

		// Ordered rather than byte-exact: KaTeX paints glyphs, not source bytes, so the mapping is
		// proportional and a rect-derived x lands on whichever side of a glyph the metrics put it.
		const early = await editor.revealOffsetAtGlyphFraction(0.2);
		await page.keyboard.press('Escape');
		await expect(editor.mathWidget).toHaveCount(1);
		const late = await editor.revealOffsetAtGlyphFraction(0.8);

		expect(early).toBeGreaterThan(0);
		expect(late!).toBeGreaterThan(early!);
		expect(late!).toBeLessThan('$alpha+beta$'.length);
		// Both only changed the view; neither edited a byte.
		expect(await editor.bridge.getSource()).toBe(LONG_FORMULA);
	});
});
