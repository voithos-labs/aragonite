import { expect } from '../../fixtures';
import { PluginsPage } from './helpers';

// Shared probe surface for the two inline-reveal command suites (the fold seam and
// Enter's block meaning). Both drive the same gestures against the `math` seed, so
// the reveal entry and the byte-at-a-time source edit live here rather than being
// carried twice.

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
