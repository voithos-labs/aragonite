import { test, expect } from '../../fixtures';
import { PluginsPage, roundTripStable } from './helpers';

/**
 * Block `$$…$$` display math: render-primary, source-on-focus (design §"Block math", flagship axes
 * A1 caret-across-swap and A7 multiline render). The reactive render↔source swap and the caret's
 * survival across it are exactly what the unit layer could not prove, so reveal, edit, blur, and
 * navigation are driven through real mouse/keyboard only. The folded render is `.math-block-render`
 * (KaTeX output `.katex`); the revealed source is the plain `$$…$$` text of `.math-block-source`.
 * Seed: `Before` / `$$x^2$$` / `After`.
 */

class BlockMathPage extends PluginsPage {
	async gotoMathBlock(seed: 'mathblock' | 'mathblock-multiline' = 'mathblock'): Promise<void> {
		await this.gotoPlugins(seed);
		await expect(this.render).toHaveCount(1);
	}

	get render() {
		return this.page.locator('.math-block-render');
	}

	get source() {
		return this.page.locator('.math-block-source');
	}

	get renderedKatex() {
		return this.page.locator('.math-block-render .katex');
	}

	/**
	 * Click the folded render to reveal its source. Block math swaps in a distinct
	 * `.math-block-source` element rather than removing the widget, so it settles on that element's
	 * arrival — not on the shared `revealWidget` count-to-zero.
	 */
	async revealByClick(): Promise<void> {
		await this.render.click();
		await expect(this.source).toHaveCount(1);
		await this.waitForRenderFlush();
	}

	/** Enter the math block from the paragraph above via a real ArrowRight, so the
	 *  caret lands through `focus(0)` — no click mouseup competing for the caret. */
	async revealFromBefore(): Promise<void> {
		await this.getBlock(0).click();
		await this.page.keyboard.press('End');
		await this.page.keyboard.press('ArrowRight');
		await expect(this.source).toHaveCount(1);
		await this.waitForRenderFlush();
	}

	/** Collapsed caret offset within the single-text-node source, or null. */
	async sourceCaretOffset(): Promise<number | null> {
		return this.page.evaluate(() => {
			const el = document.querySelector('.math-block-source');
			const sel = window.getSelection();
			if (!el || !sel || sel.rangeCount === 0) return null;
			const range = sel.getRangeAt(0);
			if (!el.contains(range.startContainer)) return null;
			return range.startOffset;
		});
	}

	async sourceText(): Promise<string> {
		return (await this.source.textContent()) ?? '';
	}

	/** Shape of the revealed source's DOM — a single text node whose text carries any
	 *  internal `\n`, the invariant the offset walk depends on (A7). */
	async sourceNodeShape(): Promise<{ singleTextNode: boolean; text: string }> {
		return this.page.evaluate(() => {
			const el = document.querySelector('.math-block-source');
			if (!el) return { singleTextNode: false, text: '' };
			return {
				singleTextNode: el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE,
				text: el.textContent ?? ''
			};
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
	let editor: BlockMathPage;

	test.beforeEach(async ({ page }) => {
		editor = new BlockMathPage(page);
		await editor.gotoMathBlock();
	});

	test('renders the KaTeX display by default without exposing the source', async () => {
		await expect(editor.renderedKatex).toHaveCount(1);
		await expect(editor.source).toHaveCount(0);
		expect(await editor.bridge.getBlockKind(1)).toBe('mathBlock');
		expect(await editor.bridge.getSource()).toContain('$$x^2$$');
	});

	test('clicking the rendered math reveals its source without touching the CST', async () => {
		await editor.revealByClick();

		await expect(editor.render).toHaveCount(0);
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
		await editor.paste('Control+v');

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

	test('A7: a multiline aligned fence renders and reveals as a single text node', async () => {
		await editor.gotoMathBlock('mathblock-multiline');
		// Renders despite the internal newlines.
		await expect(editor.renderedKatex).toHaveCount(1);

		await editor.revealByClick();
		const shape = await editor.sourceNodeShape();
		expect(shape.singleTextNode).toBe(true);
		expect(shape.text).toContain('\\begin{aligned}');
		expect(shape.text).toContain('\n');

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

	test('an undo taken inside the revealed source re-seeds it, so the blur commits nothing stale', async ({
		page
	}) => {
		// A committed edit to THIS block, so the undo below has something of its own to restore.
		await editor.revealFromBefore();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('a');
		await editor.getBlock(2).click();
		await editor.bridge.waitForSourceContains('$$ax^2$$');

		// Reveal again, type one uncommitted char, and undo from inside the source.
		await editor.revealByClick();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('b');
		await editor.undo();
		await editor.bridge.waitForSourceContains('$$x^2$$');

		// The open source now holds pre-undo text; blurring must not commit it back over the undo.
		await editor.getBlock(2).click();
		await expect(editor.renderedKatex).toHaveCount(1);
		expect(await editor.bridge.getSource()).toBe('Before\n\n$$x^2$$\n\nAfter\n');
		expect(await roundTripStable(editor.page)).toBe(true);
	});
});
