import { test, expect } from '../../fixtures';
import { MathRevealPage } from './latex-reveal-helpers';

/**
 * Where a click on a rendered `$…$` island puts the caret
 * (requirements/plugins/latex-inline-click-caret.md). The block form already reads the press as a
 * place in the equation; the inline widget seated every click at the formula's end, so editing a
 * formula's head was a click plus a walk back.
 */

const LONG_FORMULA = 'Before $alpha+beta$ after\n\nNext\n';

test.describe('inline math: a click seats the caret where it landed', () => {
	let editor: MathRevealPage;

	test.beforeEach(async ({ page }) => {
		editor = new MathRevealPage(page);
		await editor.gotoPlugins('math');
		await expect(editor.mathWidget).toHaveCount(1);
	});

	/** The painted glyph box — KaTeX's MathML twin is clipped to a pixel and measures nothing. */
	async function glyphBox(): Promise<{ x: number; y: number; width: number; height: number }> {
		const box = await editor.mathWidget.locator('.katex-html').first().boundingBox();
		if (!box) throw new Error('no glyph box for the rendered formula');
		return box;
	}

	/** Press at `x` across the glyph run, type one byte, then escape to commit it. */
	async function typeAtGlyphX(x: number, byte: string): Promise<string> {
		const box = await glyphBox();
		await editor.page.mouse.click(x, box.y + box.height / 2);
		await expect(editor.mathWidget).toHaveCount(0);

		await editor.page.keyboard.type(byte);
		await editor.page.keyboard.press('End');
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

	test('a press further along the formula seats a later offset', async ({ page }) => {
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
		// Both reveals were view toggles; neither edited a byte.
		expect(await editor.bridge.getSource()).toBe(LONG_FORMULA);
	});
});
