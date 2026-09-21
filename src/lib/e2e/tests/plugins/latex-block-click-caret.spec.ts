import { test, expect } from '../../fixtures';
import { BlockMathPage } from './latex-reveal-helpers';

/**
 * Where a click on a `$$` block puts the caret (requirements/plugins/latex-block-click-caret.md).
 * The click names a point and the point names an offset, in the rendered glyphs as in the open
 * source; putting every click at the source's end made the start of a formula a click plus several
 * arrow steps. Miss-analysis: every existing case either arrived by keyboard or pressed Home or End
 * before typing, so where the click itself landed was never the thing under test.
 */

const SEED_SOURCE = 'Before\n\n$$x^2$$\n\nAfter\n';

test.describe('block math: a click puts the caret where it landed', () => {
	let editor: BlockMathPage;

	test.beforeEach(async ({ page }) => {
		editor = new BlockMathPage(page);
		await editor.gotoMathSeed('mathblock');
	});

	/** The painted glyph box; KaTeX's MathML copy is clipped to a pixel and measures nothing. */
	async function glyphBox(): Promise<{ x: number; y: number; width: number; height: number }> {
		const box = await editor.page.locator('.katex-html').first().boundingBox();
		if (!box) throw new Error('no glyph box for the rendered equation');
		return box;
	}

	test('a click at the equation’s left edge types into the head of the formula', async () => {
		const box = await glyphBox();
		await editor.page.mouse.click(box.x + 1, box.y + box.height / 2);
		await expect(editor.source).toHaveCount(1);

		await editor.page.keyboard.type('z');
		expect(await editor.sourceText()).toBe('$$zx^2$$');
	});

	test('a click at the equation’s right edge types onto the tail of the formula', async () => {
		const box = await glyphBox();
		await editor.page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
		await expect(editor.source).toHaveCount(1);

		await editor.page.keyboard.type('z');
		expect(await editor.sourceText()).toBe('$$x^2z$$');
	});

	test('a click in the card beside the ink takes the nearest glyph', async () => {
		const card = await editor.render.boundingBox();
		const glyphs = await glyphBox();
		if (!card) throw new Error('no render card box');
		// Left of the glyphs but inside the box: the margin-click spec pins that this opens the
		// source at all, and the point clamps into the glyph box, so the nearest glyph is the
		// first one.
		expect(glyphs.x).toBeGreaterThan(card.x + 2);
		await editor.page.mouse.click(card.x + 1, card.y + card.height / 2);
		await expect(editor.source).toHaveCount(1);

		await editor.page.keyboard.type('z');
		expect(await editor.sourceText()).toBe('$$zx^2$$');
		expect(await editor.bridge.getSource()).toBe(SEED_SOURCE);
	});
});
