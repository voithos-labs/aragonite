import { test, expect } from '../../fixtures';
import { PluginsPage, clickWidgetCenter } from './helpers';

/**
 * Reveal COLLAPSE scoping for inline math, on the two-equations-one-paragraph seed (the showcase
 * shape that surfaced the class). Collapse must be selection-containment-scoped, not blur-scoped:
 * any caret escape inside the block folds the revealed source, and clicking the second widget while
 * the first is revealed is ONE fold→reveal gesture. The switch case is the race oracle — it only
 * fails under the real reactive rebuild, which is why the unit layer
 * (widget-reveal-collapse.test.ts) cannot stand in for it.
 */

const EQ1 = '$E=mc^2$';
const EQ2 = '$a^2+b^2=c^2$';

class TwoMathPage extends PluginsPage {
	get widgets() {
		return this.page.locator('.math-inline-widget');
	}

	async gotoTwoMath(): Promise<void> {
		await this.gotoPlugins('math-two');
		await expect(this.widgets).toHaveCount(2);
	}

	/**
	 * Reveal the first equation and assert the reveal HOLDS: a transient count check alone passes
	 * straight through the self-fold race (open → fold within ~50ms on the click's own queued
	 * selectionchange).
	 */
	async revealFirstByClick(): Promise<void> {
		await clickWidgetCenter(this.widgets.first());
		await expect(this.widgets).toHaveCount(1);
		await this.page.waitForTimeout(150);
		await expect(this.widgets).toHaveCount(1);
		expect(await this.getBlockText(0)).toContain(EQ1);
	}

	/** Real mouse click just left of `needle`'s first char in block [0], so the
	 *  caret lands at its leading boundary. */
	async clickTextStart(needle: string): Promise<void> {
		const rect = await this.page.evaluate((text) => {
			const wrapper = document.querySelector("[data-block-path='[0]']");
			const editable = wrapper?.querySelector('[contenteditable]');
			if (!editable) return null;
			const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
			let node: Node | null;
			while ((node = walker.nextNode())) {
				const idx = node.textContent?.indexOf(text) ?? -1;
				if (idx >= 0) {
					const range = document.createRange();
					range.setStart(node, idx);
					range.setEnd(node, idx + text.length);
					const r = range.getBoundingClientRect();
					return { left: r.left, top: r.top, height: r.height };
				}
			}
			return null;
		}, needle);
		if (!rect) throw new Error(`no text node containing "${needle}" in block [0]`);
		await this.page.mouse.click(rect.left + 1, rect.top + rect.height / 2);
	}
}

test.describe('plugin inline math: reveal collapse scoping', () => {
	let editor: TwoMathPage;

	test.beforeEach(async ({ page }) => {
		editor = new TwoMathPage(page);
		await editor.gotoTwoMath();
	});

	test('clicking prose in the same paragraph folds the reveal, caret at the click', async ({
		page
	}) => {
		await editor.revealFirstByClick();

		await editor.clickTextStart('tail');

		// eq1 re-rendered; the fold is a view toggle — the CST is untouched.
		await expect(editor.widgets).toHaveCount(2);
		expect(await editor.getBlockText(0)).not.toContain(EQ1);
		expect(await editor.bridge.getSource()).toContain(EQ1);

		// The caret stayed at the click point, not the widget's trailing edge.
		await page.keyboard.type('Q');
		await editor.bridge.waitForSourceContains('Qtail');
	});

	test('clicking the second widget while the first is revealed switches the reveal', async ({
		page
	}) => {
		await editor.revealFirstByClick();

		// eq2 is the only rendered widget left; the click must fold eq1 AND reveal eq2.
		await clickWidgetCenter(editor.widgets.first());

		await expect.poll(() => editor.getBlockText(0)).toContain(EQ2);
		expect(await editor.getBlockText(0)).not.toContain(EQ1);
		await expect(editor.widgets).toHaveCount(1);
		// The switched reveal must HOLD, not just flash open (self-fold race).
		await page.waitForTimeout(150);
		await expect(editor.widgets).toHaveCount(1);
		expect(await editor.getBlockText(0)).toContain(EQ2);

		// The new reveal is live: a typed char lands at eq2's source leading edge.
		await page.keyboard.type('z');
		expect(await editor.getBlockText(0)).toContain(`z${EQ2}`);
		// Both reveals were view toggles — the CST holds both originals.
		const source = await editor.bridge.getSource();
		expect(source).toContain(EQ1);
		expect(source).toContain(EQ2);
	});

	test('clicking a different block still folds through the blur path', async () => {
		await editor.revealFirstByClick();

		await editor.getBlock(1).click();

		await expect(editor.widgets).toHaveCount(2);
		expect(await editor.bridge.getSource()).toContain(EQ1);
	});
});
