import { test, expect } from '../../fixtures';
import { BlockMathPage } from './latex-reveal-helpers';
import { pointInGap } from '../../text-runs';

/**
 * Where a click on a `$$` block puts the caret (requirements/plugins/latex-block-click-caret.md):
 * the click's point names the offset, in the rendered glyphs as in the open source.
 * Miss-analysis: every case arrived by keyboard or pressed Home or End before typing, so where the
 * click itself landed was never under test.
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
		const glyphs = await glyphBox();
		// Left of the glyphs but inside the box: the margin-click spec checks this opens the source,
		// and the point clamps into the glyph box, so the nearest glyph is the first.
		const beside = await pointInGap(
			editor.render,
			editor.page.locator('.katex-html').first(),
			'left',
			glyphs.y + glyphs.height / 2
		);
		await editor.page.mouse.click(beside.x, beside.y);
		await expect(editor.source).toHaveCount(1);

		await editor.page.keyboard.type('z');
		expect(await editor.sourceText()).toBe('$$zx^2$$');
		expect(await editor.bridge.getSource()).toBe(SEED_SOURCE);
	});

	// A centred formula's glyph box spans the card, and a fraction's or a sum's first glyph in the
	// DOM isn't its first byte, so only these tell a click beside the ink from one on its edge glyph.
	for (const formula of [String.raw`\frac{a}{b}+c`, String.raw`\sum_{i=0}^{n} i^2`]) {
		for (const side of ['left', 'right'] as const) {
			test(`a click ${side} of a centred ${formula} types at that end of the body`, async () => {
				await editor.loadContent(`Before\n\n$$\n${formula}\n$$\n\nAfter\n`);
				await expect(editor.render).toHaveCount(1);
				const card = (await editor.render.boundingBox())!;
				const glyphs = await glyphBox();
				const x = side === 'left' ? card.x + 2 : card.x + card.width - 2;
				await editor.page.mouse.click(x, glyphs.y + glyphs.height / 2);
				await expect(editor.source).toHaveCount(1);

				await editor.page.keyboard.type('z');
				const body = side === 'left' ? `z${formula}` : `${formula}z`;
				expect(await editor.sourceText()).toBe(`$$\n${body}\n$$`);
			});
		}
	}
});
