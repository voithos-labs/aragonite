import { test, expect } from '../../fixtures';
import { roundTripStable } from './helpers';
import { BlockMathPage } from './latex-reveal-helpers';

/**
 * Block `$$…$$` display math: render-primary, source-on-focus (design §"Block math", flagship axes
 * A1 caret-across-swap and A7 multiline render). The reactive render↔source swap and the caret's
 * survival across it are exactly what the unit layer could not prove, so reveal, edit, blur, and
 * navigation are driven through real mouse/keyboard only. The folded render is `.math-block-render`
 * (KaTeX output `.katex`); the revealed source is `.math-block-source`, painted as fence lines and
 * highlight spans whose textContent is the `$$…$$` bytes. In the default split layout the render
 * stays up beside the source as a live preview. Seed: `Before` / `$$x^2$$` / `After`.
 */

class BlockMathCaretPage extends BlockMathPage {
	/** The caret's raw offset inside the math block, or null when it sits elsewhere. */
	async sourceCaretOffset(): Promise<number | null> {
		const paths = await this.bridge.getSelectionPaths();
		if (!paths || paths.anchor.path[0] !== 1) return null;
		return paths.anchor.offset;
	}

	/** The revealed source's text, with a count of the spans it is painted as. */
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

	// A block with no body line — the one-line `$$$$`, or `$$` over `$$` — reveals as opener,
	// one empty body line and closer, so the caret has a line to sit on; Backspace on that line is
	// then the block's deletion, in live mode and source mode alike.
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
			// The press lands the caret in the block above, as the code block's deletion does.
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
		// Reveal is a view toggle — the source has not changed.
		expect(await editor.bridge.getSource()).toContain('$$x^2$$');
		expect(await roundTripStable(editor.page)).toBe(true);
	});

	test('editing the source and blurring re-renders KaTeX and persists the edit', async ({
		page
	}) => {
		await editor.revealFromBefore();
		// Caret at the source leading edge; step inside the fence and insert a char.
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

		// The ephemeral source edit takes the text/plain payload, not the HTML markup: without the
		// render-primary leaf's own onpaste the native paste drops live <b> into the reveal.
		const html = await editor.source.innerHTML();
		expect(html).not.toContain('<b>');
		expect(await editor.sourceText()).toContain(' plain');
		// The edit stays ephemeral until blur — blur commits and the doc round-trips.
		await editor.getBlock(2).click();
		expect(await roundTripStable(editor.page)).toBe(true);
	});

	test('A1: the reveal caret lands at the source edge and a typed char lands inside it', async ({
		page
	}) => {
		// Keyboard entry (focus(0)) lands the caret without a click mouseup competing
		// for it — the reactive re-render must not displace it to a block edge.
		await editor.revealFromBefore();
		expect(await editor.sourceCaretOffset()).toBe(0);

		// Step two chars into the fence and type: the char lands at the caret, inside
		// the formula — not leaked to the sibling paragraph.
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
		// Painted as fence lines and highlight tokens, so the walk's textContent contract is
		// what holds the offsets exact: every internal `\n` survives, nothing is added.
		const shape = await editor.sourceShape();
		expect(shape.spans).toBeGreaterThan(1);
		expect(shape.text).toBe('$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$');

		// Blur with no edit is a pure view toggle — the bytes survive.
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
		// The source stays revealed while the selection is live — a folded island
		// could not be selected through.
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

	// Undo inside an open reveal walks the reveal's own edits first (the document's history holds
	// the session as one entry, written on blur); once that is spent the chord reaches the
	// document, whose restore re-seeds the source.
	test('undo inside the revealed source takes the draft back first, then the document', async ({
		page
	}) => {
		// A committed edit to THIS block, so the document undo below has something of its own.
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

		// The re-seeded source holds nothing of the draft; blurring commits nothing stale.
		await editor.getBlock(2).click();
		await expect(editor.renderedKatex).toHaveCount(1);
		expect(await editor.bridge.getSource()).toBe('Before\n\n$$x^2$$\n\nAfter\n');
		expect(await roundTripStable(editor.page)).toBe(true);
	});

	// The draft's own redo entry was taken against bytes the document undo replaced, so a redo
	// after the re-seed is the document's, never the stale draft painted back over new bytes.
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
