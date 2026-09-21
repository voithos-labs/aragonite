import { test, expect } from '../../fixtures';
import {
	PluginsPage,
	clickWidgetEnd,
	revealWidget,
	roundTripStable,
	textRunCenter
} from './helpers';
import { capturePageErrors } from '../../page-probes';
import { attachIme } from '../../simulation/ime';

/**
 * Inline `$…$` math: select it, its editable source opens, committing re-renders it (design §
 * "Inline edit UX", axis A1). The swap and the re-render are driven by real mouse and keyboard
 * only, with no programmatic selection, because the caret surviving the re-render is exactly what
 * the unit tests cannot prove. The widget is `.math-inline-widget`, KaTeX output is `.katex`, and
 * the open source is plain `$…$` text in the block.
 */

class MathPage extends PluginsPage {
	async gotoMath(seed: 'math' | 'math-multiline' = 'math'): Promise<void> {
		await this.gotoPlugins(seed);
		await expect(this.mathWidget).toHaveCount(1);
	}

	get mathWidget() {
		return this.page.locator('.math-inline-widget');
	}

	async revealByClick(): Promise<void> {
		await revealWidget(this.mathWidget);
	}

	/** A click at the formula's end, for a scenario that wants the caret there: the caret follows
	 *  the point (`latex-inline-click-caret.md`), so it is aimed at, not assumed. */
	async revealAtFormulaEnd(): Promise<void> {
		await clickWidgetEnd(this.mathWidget);
		await expect(this.mathWidget).toHaveCount(0);
	}

	/**
	 * Vertical center of `needle`, in block [0]. A range over the substring alone (not the whole
	 * text node, which may span the soft-wrapped break) isolates the line the needle sits on.
	 */
	async lineYContaining(needle: string): Promise<number> {
		const y = await this.page.evaluate((text) => {
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
					const rect = range.getBoundingClientRect();
					return rect.top + rect.height / 2;
				}
			}
			return null;
		}, needle);
		if (y === null) throw new Error(`no text node containing "${needle}" in block [0]`);
		return y;
	}

	/** True when the collapsed selection currently sits inside block [0]. */
	async selectionInMathBlock(): Promise<boolean> {
		return this.page.evaluate(() => {
			const wrapper = document.querySelector("[data-block-path='[0]']");
			const editable = wrapper?.querySelector('[contenteditable]');
			const sel = window.getSelection();
			if (!editable || !sel || sel.rangeCount === 0) return false;
			return editable.contains(sel.getRangeAt(0).startContainer);
		});
	}
}

test.describe('plugin inline math: select → reveal-source editing', () => {
	let editor: MathPage;

	test.beforeEach(async ({ page }) => {
		editor = new MathPage(page);
		await editor.gotoMath();
	});

	test('clicking the rendered math reveals its source without touching the CST', async () => {
		expect(await editor.bridge.getSource()).toContain('Before $x^2$ after');
		await editor.revealByClick();

		// The widget is gone and the raw `$…$` is visible, editable text.
		expect(await editor.getBlockText(0)).toContain('$x^2$');
		// Opening the source only changes the view: the source itself has not changed.
		expect(await editor.bridge.getSource()).toContain('Before $x^2$ after');
	});

	// The rule belongs to the one place sources open, not to the footnote widget: the first click
	// opens it, and the browser's word rule would take `$` from the source as a word of its own.
	test('a double-click on the rendered math selects the whole revealed token', async ({ page }) => {
		const box = await editor.mathWidget.boundingBox();
		if (!box) throw new Error('math widget has no bounding box');

		await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
		await editor.waitForRenderFlush();

		await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('$x^2$');
	});

	test('clicking column-aligned text on another visual line places the caret, not reveal', async ({
		page
	}) => {
		await editor.gotoMath('math-multiline');

		const widgetBox = await editor.mathWidget.boundingBox();
		if (!widgetBox) throw new Error('math widget has no bounding box');
		const line2Y = await editor.lineYContaining('second visual line');
		// Premise: the second line renders below the widget, so the point below is
		// genuinely a different visual line sharing the widget's column.
		expect(line2Y).toBeGreaterThan(widgetBox.y + widgetBox.height);

		// Click at the widget's horizontal center but on line 2: same column, other line.
		await page.mouse.click(widgetBox.x + widgetBox.width / 2, line2Y);
		await editor.waitForRenderFlush();

		// The widget is untouched: the click landed on real text, not on it.
		await expect(editor.mathWidget).toHaveCount(1);

		// The caret really landed in the second line's text: a typed character goes into the
		// block's source while the formula stays rendered and never opens for editing.
		await page.keyboard.type('Q');
		await editor.bridge.waitForSourceContains('Q');
		const source = await editor.bridge.getSource();
		expect(source).toContain('$x^2$');
		expect(source).toContain('visual line here');
	});

	test('keyboard caret-entry from the left reveals the source at the leading edge', async ({
		page
	}) => {
		await editor.getBlock(0).click();
		await page.keyboard.press('Home');
		// "Before " is 7 characters: 7 steps reach the widget's leading edge and the eighth enters
		// it. Under the Obsidian model entering opens the source in place rather than resting in
		// an invisible selected-widget state waiting for Enter.
		for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');

		await expect(editor.mathWidget).toHaveCount(0);
		// Opening the source only changes the view: the CST source is unchanged.
		expect(await editor.bridge.getSource()).toContain('Before $x^2$ after');
		// Caret at the leading edge: a typed character lands before the opening `$`.
		await page.keyboard.type('Z');
		const revealed = await editor.getBlockText(0);
		expect(revealed).toContain('Z$x^2$');
		expect(revealed).not.toContain('$x^2$Z');
	});

	test('editing the source and walking the caret out re-renders KaTeX and persists the edit', async ({
		page
	}) => {
		await editor.revealAtFormulaEnd();
		// Clicked at the formula's end, so the caret sits inside the closing `$` and typing
		// continues the formula.
		await page.keyboard.type('y');
		// End carries the caret out of the source, which is what commits an edited one. Enter does
		// not commit; it is the block's split key (latex-inline-reveal-commands).
		await page.keyboard.press('End');

		await expect(editor.mathWidget).toHaveCount(1);
		await expect(editor.mathWidget.locator('.katex')).toHaveCount(1);
		await editor.bridge.waitForSourceContains('$x^2y$');
		expect(await editor.bridge.getSource()).toContain('Before $x^2y$ after');
		expect(await editor.bridge.getSource()).not.toContain('$x^2$ after');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('the reveal caret lands in the source and the commit lands it at the trailing edge', async ({
		page
	}) => {
		await editor.revealAtFormulaEnd();
		// A character typed right after the source opens lands where the click did, inside the
		// closing `$`: not at a block edge, where a lost caret would drop it, and not past it.
		await page.keyboard.type('z');
		const revealed = await editor.getBlockText(0);
		expect(revealed).toContain('$x^2z$');
		expect(revealed).not.toContain('zBefore');

		await page.keyboard.press('End');
		await expect(editor.mathWidget).toHaveCount(1);
		// The commit left the caret at the formula's trailing edge, so the next character lands
		// immediately after the re-rendered widget: the End position does not survive the commit,
		// the widget's trailing edge does.
		await page.keyboard.type('!');
		await editor.bridge.waitForSourceContains('$x^2z$!');
		expect(await editor.bridge.getSource()).toContain('Before $x^2z$! after');
	});

	test('Escape discards the source edit and restores the rendered widget', async ({ page }) => {
		await editor.revealByClick();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('y');
		// Escape renders the widget again from the untouched raw, discarding the edit.
		await page.keyboard.press('Escape');

		await expect(editor.mathWidget).toHaveCount(1);
		await expect(editor.mathWidget.locator('.katex')).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain('Before $x^2$ after');
		expect(await editor.bridge.getSource()).not.toContain('$yx^2$');
	});

	test('IME composition in the revealed source commits only on blur', async ({ page }) => {
		await editor.revealAtFormulaEnd();
		const ime = await attachIme(page);
		await ime.compose('yy');
		await ime.commit('yy');

		// The composition is not committed: nothing has reached the CST yet.
		await editor.waitForRenderFlush();
		expect(await editor.bridge.getSource()).toContain('Before $x^2$ after');

		// Focus leaves the block, so the composed source commits and re-renders.
		await editor.getBlock(1).click();
		await editor.bridge.waitForSourceContains('$x^2yy$');
		await expect(editor.mathWidget).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain('Before $x^2yy$ after');

		// The commit on blur must not pull the caret back: focus moved to the next block, so the
		// selection stays there and the math block just blurred never takes it.
		await editor.waitForRenderFlush();
		expect(await editor.selectionInMathBlock()).toBe(false);
	});

	test('committing a revealed widget with no edit keeps the prior undo entry reachable', async ({
		page
	}) => {
		// A real edit in the sibling paragraph: the entry the next Ctrl+Z must reach.
		await editor.getBlock(1).click();
		await page.keyboard.press('End');
		await page.keyboard.type('ABC');
		await editor.bridge.waitForSourceContains('NextABC');
		await editor.waitForUndoBatchFlush();

		// Open the formula and commit with no edit. A commit that changed nothing would still push
		// an undo entry, and this Ctrl+Z would undo that instead of the ABC edit.
		await editor.revealByClick();
		await page.keyboard.press('End');
		await expect(editor.mathWidget).toHaveCount(1);

		await editor.undo();
		await editor.bridge.waitForSourceNotContains('ABC');
	});

	test('a cross-block selection through the revealed source survives a blur without folding', async ({
		page
	}) => {
		const pageErrors = capturePageErrors(page);

		await editor.revealByClick();
		// Extending by keyboard is decided from visual-line geometry, and a KaTeX font swap
		// partway through a measurement, which happens under busy parallel workers, breaks the
		// last-line check, so wait for fonts before the gesture.
		await page.evaluate(() => document.fonts.ready);
		// Extend down into the next paragraph straight from the caret the open source left. That
		// caret sits inside the source, at a mid-block offset, and the block is one visual line,
		// so the first Shift+ArrowDown extends to the line's end inside the block. Extending keeps
		// the source open, unlike a collapsed End, which would leave the widget and close it. The
		// second crosses into the next block, with the anchor staying inside the open source.
		await page.keyboard.press('Shift+ArrowDown');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		// The source stays open while the selection is live: a rendered widget could not be
		// selected through, and closing it would strand the anchored endpoint.
		await expect(editor.mathWidget).toHaveCount(0);
		const paths = await editor.bridge.getSelectionPaths();
		expect(paths).not.toBeNull();
		expect([paths!.anchor.path[0], paths!.focus.path[0]].sort()).toEqual([0, 1]);

		// Blur while the cross-block selection is live. No mouse or keyboard gesture moves focus
		// off the block without collapsing the selection, so the blur is fired directly. The
		// commit must stop on a cross-block range rather than close the source under its anchor.
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await editor.waitForRenderFlush();

		await expect(editor.mathWidget).toHaveCount(0);
		expect(pageErrors).toEqual([]);
	});
});

// The whole-token rule belongs to the double-click that opened the source. Once it is showing, it
// is ordinary text and the browser's word rule owns the gesture.
test.describe('plugin inline math: a double-click inside an open reveal', () => {
	for (const mode of ['source', 'live'] as const) {
		test(`${mode} mode: takes the word, not the whole token`, async ({ page }) => {
			const editor = new MathPage(page);
			await editor.gotoPlugins('math');
			await editor.loadContent('Before $alpha beta gamma$ after\n\nNext\n');
			await editor.setPresentationMode(mode);
			await expect(editor.mathWidget).toHaveCount(1);

			await editor.revealByClick();

			const word = await textRunCenter(page, [0], 'beta');
			await page.mouse.dblclick(word.x, word.y);
			await editor.waitForRenderFlush();

			// Trimmed: the browser's word rule takes the trailing space, and what this checks is
			// that the `$` delimiters stay outside the selection.
			await expect
				.poll(() => page.evaluate(() => window.getSelection()?.toString().trim()))
				.toBe('beta');
		});
	}
});
