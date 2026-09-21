import { expect } from '../../fixtures';
import { PluginsPage } from './helpers';

// Shared page helpers for the latex suites that open a formula's source: the inline widget, in
// MathRevealPage, used by the commit-first tests and by Enter's block meaning, and the block and
// fence swap between render and source, in BlockMathPage. Each is one gesture set shared by
// several specs, so both live here.

export class BlockMathPage extends PluginsPage {
	get render() {
		return this.page.locator('.math-block-render');
	}

	get source() {
		return this.page.locator('.math-block-source');
	}

	get renderedKatex() {
		return this.page.locator('.math-block-render .katex');
	}

	async sourceText(): Promise<string> {
		return (await this.source.textContent()) ?? '';
	}

	async gotoMathSeed(seed: 'mathblock' | 'mathblock-multiline' | 'mathfence'): Promise<void> {
		await this.gotoPlugins(seed);
		await expect(this.render).toHaveCount(1);
	}

	/**
	 * Click the render to open its source. Block math swaps in a separate `.math-block-source`
	 * element rather than removing the widget, so this waits for that element to appear instead of
	 * for the shared `revealWidget` count to reach zero.
	 */
	async revealByClick(): Promise<void> {
		await this.render.click();
		await expect(this.source).toHaveCount(1);
		await this.waitForRenderFlush();
	}

	/** Enter the math block from the paragraph above with a real ArrowRight, so the caret lands
	 *  through `focus(0)` with no mouseup competing for it. */
	async revealFromBefore(): Promise<void> {
		await this.getBlock(0).click();
		await this.page.keyboard.press('End');
		await this.page.keyboard.press('ArrowRight');
		await expect(this.source).toHaveCount(1);
		await this.waitForRenderFlush();
	}
}

export class MathRevealPage extends PluginsPage {
	get mathWidget() {
		return this.page.locator('.math-inline-widget');
	}

	/** Open the source from the trailing edge of the math in `block`: put the caret past the
	 *  widget, then one Backspace, which opens it without touching a byte. */
	async revealFromTrailingEdge(block: number): Promise<void> {
		await this.focusBlockEnd(block);
		await this.page.keyboard.press('Backspace');
		await expect(this.mathWidget).toHaveCount(0);
	}

	/** Open the source from the leading edge of a block that starts with math, then step `into`
	 *  bytes further so an edit lands inside the formula. */
	async revealFromLeadingEdge(block: number, into = 0): Promise<void> {
		await this.focusBlockStart(block);
		await this.page.keyboard.press('ArrowRight');
		await expect(this.mathWidget).toHaveCount(0);
		for (let i = 0; i < into; i++) await this.page.keyboard.press('ArrowRight');
	}

	/** Click that far across the painted glyph run and report the offset the caret ended at,
	 *  within the open source's own text node. */
	async revealOffsetAtGlyphFraction(fraction: number): Promise<number | null> {
		const box = await this.mathWidget.locator('.katex-html').first().boundingBox();
		if (!box) throw new Error('no glyph box for the rendered formula');
		await this.page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
		await expect(this.mathWidget).toHaveCount(0);
		return this.page.evaluate(() => {
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) return null;
			const range = selection.getRangeAt(0);
			// Null unless the caret is in the open source itself: the offset means nothing
			// measured against a neighbouring prose text node.
			const text = range.startContainer.textContent ?? '';
			return /^\$.*\$$/.test(text) ? range.startOffset : null;
		});
	}

	/** Backspace once per entry, waiting on the open source's visible text after each keypress.
	 *  The CST does not change while it is open, so the DOM is the only thing to read. */
	async backspaceRevealed(block: number, texts: string[]): Promise<void> {
		for (const expected of texts) {
			await this.page.keyboard.press('Backspace');
			await expect(this.getBlock(block)).toHaveText(expected);
		}
	}
}
