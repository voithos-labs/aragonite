import { test, expect } from '../../fixtures';
import { PluginsPage, revealWidget, roundTripStable } from './helpers';
import { capturePageErrors } from '../../page-probes';
import { attachIme } from '../../simulation/ime';

/**
 * Inline `$…$` math: select → reveal editable source → commit re-renders (design §"Inline edit UX",
 * flagship axis A1). The reveal swap and the commit re-render are driven through real
 * mouse/keyboard only — no programmatic selection — because the reactive-re-render survival of the
 * caret is exactly what the unit layer could not prove. The math widget is `.math-inline-widget`;
 * KaTeX output is `.katex`; the revealed source is plain `$…$` text in the block.
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

		// The opaque widget is gone; the raw `$…$` is now visible, editable text.
		expect(await editor.getBlockText(0)).toContain('$x^2$');
		// Reveal is a view toggle — the source has not changed.
		expect(await editor.bridge.getSource()).toContain('Before $x^2$ after');
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

		// The widget is untouched — the click landed on real text, not on the widget.
		await expect(editor.mathWidget).toHaveCount(1);

		// The caret really landed in line-2 text: a typed char enters the block source
		// while the math source stays folded (never revealed for editing).
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
		// "Before " is 7 chars: 7 steps reach the widget's leading edge; the 8th ENTERS it. Under
		// the Obsidian model an entry reveals the source in place, rather than parking in an
		// invisible widget-selected state awaiting Enter.
		for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');

		await expect(editor.mathWidget).toHaveCount(0);
		// Reveal is a view toggle — the CST source is unchanged.
		expect(await editor.bridge.getSource()).toContain('Before $x^2$ after');
		// Caret at the leading edge: a typed char lands BEFORE the opening `$`.
		await page.keyboard.type('Z');
		const revealed = await editor.getBlockText(0);
		expect(revealed).toContain('Z$x^2$');
		expect(revealed).not.toContain('$x^2$Z');
	});

	test('editing the source and walking the caret out re-renders KaTeX and persists the edit', async ({
		page
	}) => {
		await editor.revealByClick();
		// Move into the source (past the opening `$`) and type inside the formula.
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('y');
		// End carries the caret out of the source, which is what folds an edited reveal.
		// Enter does not commit — it is the block's split key (latex-inline-reveal-commands).
		await page.keyboard.press('End');

		await expect(editor.mathWidget).toHaveCount(1);
		await expect(editor.mathWidget.locator('.katex')).toHaveCount(1);
		await editor.bridge.waitForSourceContains('$yx^2$');
		expect(await editor.bridge.getSource()).toContain('Before $yx^2$ after');
		expect(await editor.bridge.getSource()).not.toContain('$x^2$ after');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('the reveal caret lands in the source and the commit lands it at the trailing edge', async ({
		page
	}) => {
		await editor.revealByClick();
		// A char typed right after reveal lands at the source's leading edge — not at a
		// block edge, which is where a lost caret would drop it.
		await page.keyboard.type('z');
		const revealed = await editor.getBlockText(0);
		expect(revealed).toContain('z$x^2$');
		expect(revealed).not.toContain('zBefore');

		await page.keyboard.press('End');
		await expect(editor.mathWidget).toHaveCount(1);
		// Commit landed the caret at the math's trailing edge: the next char lands immediately
		// after the re-rendered widget — the escape's own End position does not survive the fold,
		// the widget's trailing edge does.
		await page.keyboard.type('!');
		await editor.bridge.waitForSourceContains('$x^2$!');
		expect(await editor.bridge.getSource()).toContain('Before z$x^2$! after');
	});

	test('Escape discards the source edit and restores the rendered widget', async ({ page }) => {
		await editor.revealByClick();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('y');
		// Escape reverts to the rendered widget from the untouched raw — edit discarded.
		await page.keyboard.press('Escape');

		await expect(editor.mathWidget).toHaveCount(1);
		await expect(editor.mathWidget.locator('.katex')).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain('Before $x^2$ after');
		expect(await editor.bridge.getSource()).not.toContain('$yx^2$');
	});

	test('IME composition in the revealed source commits only on blur', async ({ page }) => {
		await editor.revealByClick();
		await page.keyboard.press('ArrowRight');
		const ime = await attachIme(page);
		await ime.compose('yy');
		await ime.commit('yy');

		// Composition is ephemeral: nothing committed to the CST yet.
		await editor.waitForRenderFlush();
		expect(await editor.bridge.getSource()).toContain('Before $x^2$ after');

		// Focus leaves the block → the composed source commits and re-renders.
		await editor.getBlock(1).click();
		await editor.bridge.waitForSourceContains('$yyx^2$');
		await expect(editor.mathWidget).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain('Before $yyx^2$ after');

		// The blur-commit must not yank the caret back: focus moved to the next block,
		// so the selection stays there — the just-blurred math block never steals it.
		await editor.waitForRenderFlush();
		expect(await editor.selectionInMathBlock()).toBe(false);
	});

	test('committing a revealed widget with no edit keeps the prior undo entry reachable', async ({
		page
	}) => {
		// A real edit in the sibling paragraph — the entry the next Ctrl+Z must reach.
		await editor.getBlock(1).click();
		await page.keyboard.press('End');
		await page.keyboard.type('ABC');
		await editor.bridge.waitForSourceContains('NextABC');
		await editor.waitForUndoBatchFlush();

		// Reveal the math and commit with NO edit. A zero-diff commit would push a dead
		// undo entry, so this Ctrl+Z would revert the no-op instead of the ABC edit.
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
		// The keyboard-extend decision is visual-line GEOMETRY; a KaTeX font swap mid-measure
		// (reachable under saturated parallel workers) breaks the last-line detection, so settle
		// fonts before the gesture.
		await page.evaluate(() => document.fonts.ready);
		// Extend down into the next paragraph straight from the reveal caret. The reveal caret
		// lands at the source's leading edge (a mid-block offset) and the block is one visual line,
		// so the FIRST Shift+ArrowDown extends to the line end within the block — a
		// shift-extension, which keeps the source revealed (unlike a collapsed End press, which
		// would escape the island and fold it). The SECOND crosses the boundary, with the anchor
		// staying INSIDE the revealed source throughout.
		await page.keyboard.press('Shift+ArrowDown');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		// The source stays revealed while the selection is live — a folded island could
		// not be selected through, and folding would strand the anchored endpoint.
		await expect(editor.mathWidget).toHaveCount(0);
		const paths = await editor.bridge.getSelectionPaths();
		expect(paths).not.toBeNull();
		expect([paths!.anchor.path[0], paths!.focus.path[0]].sort()).toEqual([0, 1]);

		// Blur while the cross-block selection is live. No mouse/keyboard gesture moves focus off
		// the block without collapsing the selection, so the blur is fired directly. The commit must
		// bail on cross-block, not fold the source out from under the anchored endpoint.
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await editor.waitForRenderFlush();

		await expect(editor.mathWidget).toHaveCount(0);
		expect(pageErrors).toEqual([]);
	});
});
