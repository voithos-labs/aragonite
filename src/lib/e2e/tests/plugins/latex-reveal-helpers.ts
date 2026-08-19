import { expect } from '../../fixtures';
import { PluginsPage } from './helpers';

// Shared probe surfaces for the latex reveal suites: the inline-widget reveal (MathRevealPage,
// used by the fold seam and Enter's block meaning) and the block/fence render↔source swap
// (BlockMathPage). Both surfaces are one gesture set across several specs, so they live here.

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
}

export class MathRevealPage extends PluginsPage {
	get mathWidget() {
		return this.page.locator('.math-inline-widget');
	}

	/** Open the trailing-edge reveal on the math in `block`: place the caret past
	 *  the widget, then one Backspace, which reveals without touching a byte. */
	async revealFromTrailingEdge(block: number): Promise<void> {
		await this.focusBlockEnd(block);
		await this.page.keyboard.press('Backspace');
		await expect(this.mathWidget).toHaveCount(0);
	}

	/** Open the leading-edge reveal on a block that STARTS with math, then step
	 *  `into` bytes deeper so an edit lands inside the formula. */
	async revealFromLeadingEdge(block: number, into = 0): Promise<void> {
		await this.focusBlockStart(block);
		await this.page.keyboard.press('ArrowRight');
		await expect(this.mathWidget).toHaveCount(0);
		for (let i = 0; i < into; i++) await this.page.keyboard.press('ArrowRight');
	}

	/** Backspace once per entry, settling on the revealed source's visible text after
	 *  each press. The CST is frozen while revealed, so the DOM is the only oracle. */
	async backspaceRevealed(block: number, texts: string[]): Promise<void> {
		for (const expected of texts) {
			await this.page.keyboard.press('Backspace');
			await expect(this.getBlock(block)).toHaveText(expected);
		}
	}
}
