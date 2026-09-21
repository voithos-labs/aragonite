import { test, expect } from '../../fixtures';
import { roundTripStable } from './helpers';
import { BlockMathPage } from './latex-reveal-helpers';

/**
 * Block `$$…$$` display maths: rendered first, source shown on focus (design § "Block math", axes
 * A1, the caret across the swap, and A7, multiline render). The swap between render and source and
 * the caret surviving it are exactly what the unit tests cannot prove, so opening, editing,
 * blurring and moving are all driven by real mouse and keyboard. The render is
 * `.math-block-render`, with KaTeX output in `.katex`; the source is `.math-block-source`, drawn as
 * fence lines and highlight spans whose textContent is the `$$…$$` bytes. In the default split
 * layout the render stays beside the source as a live preview. Seed: `Before` / `$$x^2$$` / `After`.
 */

class BlockMathCaretPage extends BlockMathPage {
	/** The caret's raw offset inside the math block, or null when it sits elsewhere. */
	async sourceCaretOffset(): Promise<number | null> {
		const paths = await this.bridge.getSelectionPaths();
		if (!paths || paths.anchor.path[0] !== 1) return null;
		return paths.anchor.offset;
	}

	/** The shown source's text, with a count of the spans it is drawn as. */
	async sourceShape(): Promise<{ spans: number; text: string }> {
		return this.page.evaluate(() => {
			const el = document.querySelector('.math-block-source');
			if (!el) return { spans: 0, text: '' };
			return { spans: el.querySelectorAll('span').length, text: el.textContent ?? '' };
		});
	}

	/** True when the collapsed caret sits inside the top-level block at `index`. */
	async selectionInBlock(index: number): Promise<boolean> {
		return this.page.evaluate((i) => {
			const wrapper = document.querySelector(`[data-block-path='[${i}]']`);
			const sel = window.getSelection();
			if (!wrapper || !sel || sel.rangeCount === 0) return false;
			return wrapper.contains(sel.getRangeAt(0).startContainer);
		}, index);
	}
}

test.describe('plugin block math: render-primary, source-on-focus', () => {
	let editor: BlockMathCaretPage;

	test.beforeEach(async ({ page }) => {
		editor = new BlockMathCaretPage(page);
		await editor.gotoMathSeed('mathblock');
	});

	// A block with no body line, whether the one-line `$$$$` or `$$` over `$$`, opens as an opener,
	// one empty body line and a closer, so the caret has a line to sit on. Backspace on that line
	// is then the block's deletion, in live mode and source mode alike.
	for (const mode of ['live', 'source'] as const) {
		test(`an empty block gains a body line on reveal and Backspace deletes it (${mode})`, async ({
			page
		}) => {
			await editor.setPresentationMode(mode);
			await editor.loadContent('Before\n\n$$$$\n');
			await editor.render.click();
			await expect(editor.source).toHaveText('$$\n\n$$');

			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals('Before\n');
			expect(await editor.bridge.getBlockCount()).toBe(1);
			// The key leaves the caret in the block above, as deleting a code block does.
			await expect(editor.getBlock(0)).toContainText('Before');
			expect(await editor.selectionInBlock(0)).toBe(true);
		});
	}

	test('Backspace at the start of a body with content does not delete the block', async ({
		page
	}) => {
		await editor.render.click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Backspace');
		await editor.getBlock(0).click();
		await editor.bridge.waitForSourceEquals('Before\n\n$$x^2$$\n\nAfter\n');
	});

	test('renders the KaTeX display by default without exposing the source', async () => {
		await expect(editor.renderedKatex).toHaveCount(1);
		await expect(editor.source).toHaveCount(0);
		expect(await editor.bridge.getBlockKind(1)).toBe('mathBlock');
		expect(await editor.bridge.getSource()).toContain('$$x^2$$');
	});

	test('clicking the rendered math reveals its source without touching the CST', async () => {
		await editor.revealByClick();

		// The render stays as the split layout's live preview; the source is what took the click.
		await expect(editor.page.locator('.math-block-editing')).toHaveCount(1);
		await expect(editor.render).toHaveCount(1);
		await expect(editor.source).toBeFocused();
		expect(await editor.sourceText()).toContain('$$x^2$$');
		// Showing the source only changes the view: the source has not changed.
		expect(await editor.bridge.getSource()).toContain('$$x^2$$');
		expect(await roundTripStable(editor.page)).toBe(true);
	});

	test('editing the source and blurring re-renders KaTeX and persists the edit', async ({
		page
	}) => {
		await editor.revealFromBefore();
		// Caret at the source's leading edge: step inside the fence and insert a character.
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('a');
		// Blur by clicking the paragraph below → commit + re-render.
		await editor.getBlock(2).click();

		await editor.bridge.waitForSourceContains('$$ax^2$$');
		await expect(editor.renderedKatex).toHaveCount(1);
		await expect(editor.source).toHaveCount(0);
		expect(await editor.bridge.getSource()).toContain('$$ax^2$$');
		expect(await roundTripStable(editor.page)).toBe(true);
	});

	test('a paste into the revealed source is intercepted to plain text (no live HTML)', async ({
		page
	}) => {
		await editor.revealByClick();
		await page.keyboard.press('End');
		await page.evaluate(async () => {
			await navigator.clipboard.write([
				new ClipboardItem({
					'text/plain': new Blob([' plain'], { type: 'text/plain' }),
					'text/html': new Blob(['<b>BOLD</b>'], { type: 'text/html' })
				})
			]);
		});
		await editor.paste();

		// The uncommitted source edit takes the text/plain payload, not the HTML markup: without
		// this block's own onpaste the browser's paste drops a live <b> into the shown source.
		const html = await editor.source.innerHTML();
		expect(html).not.toContain('<b>');
		expect(await editor.sourceText()).toContain(' plain');
		// The edit stays uncommitted until blur, which commits it and the document round-trips.
		await editor.getBlock(2).click();
		expect(await roundTripStable(editor.page)).toBe(true);
	});

	test('A1: the reveal caret lands at the source edge and a typed char lands inside it', async ({
		page
	}) => {
		// Entering by keyboard, with focus(0), lands the caret with no mouseup competing for it,
		// and the re-render must not move it to a block edge.
		await editor.revealFromBefore();
		expect(await editor.sourceCaretOffset()).toBe(0);

		// Step two characters into the fence and type: the character lands at the caret, inside
		// the formula, and not in the sibling paragraph.
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('z');
		expect(await editor.sourceText()).toBe('$$zx^2$$');
		expect(await editor.getBlockText(0)).toBe('Before');
	});

	test('A7: a multiline aligned fence renders and reveals byte-for-byte across its spans', async () => {
		await editor.gotoMathSeed('mathblock-multiline');
		// Renders despite the internal newlines.
		await expect(editor.renderedKatex).toHaveCount(1);

		await editor.revealByClick();
		// Drawn as fence lines and highlight tokens, so what keeps the offsets exact is the rule
		// that textContent matches the raw: every internal `\n` survives and nothing is added.
		const shape = await editor.sourceShape();
		expect(shape.spans).toBeGreaterThan(1);
		expect(shape.text).toBe('$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$');

		// Blur with no edit only changes the view, and the bytes survive.
		await editor.getBlock(2).click();
		await expect(editor.renderedKatex).toHaveCount(1);
		expect(await roundTripStable(editor.page)).toBe(true);
	});

	test('ArrowRight from the previous block reveals; ArrowRight past the end folds and moves on', async ({
		page
	}) => {
		await editor.revealFromBefore();
		expect(await editor.sourceCaretOffset()).toBe(0);

		// End of the single-line source, then one more step exits to the next block.
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowRight');
		await expect(editor.source).toHaveCount(0);
		await expect(editor.render).toHaveCount(1);
		expect(await editor.selectionInBlock(2)).toBe(true);
	});

	test('ArrowLeft at the source start folds and moves to the previous block', async ({ page }) => {
		await editor.revealByClick();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowLeft');
		await expect(editor.source).toHaveCount(0);
		await expect(editor.render).toHaveCount(1);
		expect(await editor.selectionInBlock(0)).toBe(true);
	});

	test('ArrowDown/ArrowUp traverse in and out of the block by sticky column', async ({ page }) => {
		await editor.getBlock(0).click();
		await page.keyboard.press('ArrowDown');
		await expect(editor.source).toHaveCount(1);

		// Single visual line: ArrowDown exits downward to the paragraph below.
		await page.keyboard.press('ArrowDown');
		await expect(editor.source).toHaveCount(0);
		expect(await editor.selectionInBlock(2)).toBe(true);

		// And back up into the block, then out the top.
		await page.keyboard.press('ArrowUp');
		await expect(editor.source).toHaveCount(1);
		await page.keyboard.press('ArrowUp');
		await expect(editor.source).toHaveCount(0);
		expect(await editor.selectionInBlock(0)).toBe(true);
	});

	test('a selection extended across the revealed source enters cross-block mode', async ({
		page
	}) => {
		await editor.revealByClick();
		await page.keyboard.press('Home');
		// Shift+ArrowLeft at the source start extends into the paragraph above.
		await page.keyboard.press('Shift+ArrowLeft');

		await editor.waitForCrossBlock(true);
		// The source stays shown while the selection is live; a rendered widget could not be
		// selected through.
		await expect(editor.source).toHaveCount(1);
		const paths = await editor.bridge.getSelectionPaths();
		expect(paths).not.toBeNull();
		expect([paths!.anchor.path[0], paths!.focus.path[0]].sort()).toEqual([0, 1]);
	});

	test('undo after reveal→edit→commit restores the pre-edit source in one step', async ({
		page
	}) => {
		await editor.revealFromBefore();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('a');
		await editor.getBlock(2).click();
		await editor.bridge.waitForSourceContains('$$ax^2$$');

		await editor.undo();
		await editor.bridge.waitForSourceContains('$$x^2$$');
		await editor.bridge.waitForSourceNotContains('$$ax^2$$');
		await expect(editor.renderedKatex).toHaveCount(1);
	});

	// Undo while the source is open walks that draft's own edits first, since the document's
	// history holds the whole session as one entry written on blur; once the draft is spent the
	// chord reaches the document, whose restore refills the source.
	test('undo inside the revealed source takes the draft back first, then the document', async ({
		page
	}) => {
		// A committed edit to this block, so the document undo below has something of its own.
		await editor.revealFromBefore();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('a');
		await editor.getBlock(2).click();
		await editor.bridge.waitForSourceContains('$$ax^2$$');

		await editor.revealByClick();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('b');
		await expect(editor.source).toHaveText('$$bax^2$$');

		await editor.undo();
		await expect(editor.source).toHaveText('$$ax^2$$');
		expect(await editor.bridge.getSource()).toContain('$$ax^2$$');

		await editor.undo();
		await editor.bridge.waitForSourceContains('$$x^2$$');
		await expect(editor.source).toHaveText('$$x^2$$');

		// The refilled source holds nothing of the draft, so blurring commits nothing stale.
		await editor.getBlock(2).click();
		await expect(editor.renderedKatex).toHaveCount(1);
		expect(await editor.bridge.getSource()).toBe('Before\n\n$$x^2$$\n\nAfter\n');
		expect(await roundTripStable(editor.page)).toBe(true);
	});

	// The draft's own redo entry was taken against bytes the document undo replaced, so a redo
	// after the refill is the document's, never the stale draft painted back over new bytes.
	test('redo after a document undo re-seeded the source is the document’s, not the draft’s', async ({
		page
	}) => {
		await editor.revealFromBefore();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('a');
		await editor.getBlock(2).click();
		await editor.bridge.waitForSourceContains('$$ax^2$$');

		await editor.revealByClick();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('b');
		await editor.undo();
		await editor.undo();
		await editor.bridge.waitForSourceContains('$$x^2$$');

		await editor.redo();
		await editor.bridge.waitForSourceContains('$$ax^2$$');
		await expect(editor.source).toHaveText('$$ax^2$$');

		await editor.getBlock(2).click();
		expect(await editor.bridge.getSource()).toBe('Before\n\n$$ax^2$$\n\nAfter\n');
		expect(await roundTripStable(editor.page)).toBe(true);
	});
});
