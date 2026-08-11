import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/**
 * Horizontal caret entry against an inline-math widget opens the source reveal (Obsidian model) —
 * the caret never parks in the invisible widget-selected state.
 * Reveal-vs-select dispatch is unit-pinned (widget-entry-dispatch.test.ts); this drives the real
 * keyboard gestures and verifies caret DIRECTION by typing a marker char. Image contrast:
 * blocks/image/{caret-arrows-horizontal,backspace-delete}.spec.ts — an image selects here.
 */

class MathEntryPage extends PluginsPage {
	get mathWidget() {
		return this.page.locator('.math-inline-widget');
	}

	async gotoMath(): Promise<void> {
		await this.gotoPlugins('math');
		await expect(this.mathWidget).toHaveCount(1);
	}

	/** Land the caret immediately right of `$x^2$` (raw offset 12) in the seed
	 *  `Before $x^2$ after`: End, then ArrowLeft through " after" (6 chars). */
	async caretRightOfWidget(): Promise<void> {
		await this.getBlock(0).click();
		await this.page.keyboard.press('End');
		for (let i = 0; i < 6; i++) await this.page.keyboard.press('ArrowLeft');
	}

	/** Land the caret immediately left of `$x^2$` (raw offset 7): Home, then
	 *  ArrowRight through "Before " (7 chars). */
	async caretLeftOfWidget(): Promise<void> {
		await this.getBlock(0).click();
		await this.page.keyboard.press('Home');
		for (let i = 0; i < 7; i++) await this.page.keyboard.press('ArrowRight');
	}
}

test.describe('inline math: horizontal caret entry reveals the source', () => {
	let editor: MathEntryPage;

	test.beforeEach(async ({ page }) => {
		editor = new MathEntryPage(page);
		await editor.gotoMath();
	});

	test('ArrowLeft right of the widget reveals at the trailing edge, zero byte change', async ({
		page
	}) => {
		await editor.caretRightOfWidget();
		// The caret sits right of the widget; it is still rendered and unedited.
		await expect(editor.mathWidget).toHaveCount(1);

		await page.keyboard.press('ArrowLeft');

		await expect(editor.mathWidget).toHaveCount(0);
		// Entry is a pure view toggle — no CST mutation, no undo entry.
		expect(await editor.bridge.getSource()).toContain('Before $x^2$ after');
		// Caret at the trailing edge: a typed char lands AFTER the closing `$`.
		await page.keyboard.type('Z');
		const revealed = await editor.getBlockText(0);
		expect(revealed).toContain('$x^2$Z');
		expect(revealed).not.toContain('Z$x^2$');
	});

	test('ArrowRight left of the widget reveals at the leading edge', async ({ page }) => {
		await editor.caretLeftOfWidget();
		await page.keyboard.press('ArrowRight');

		await expect(editor.mathWidget).toHaveCount(0);
		expect(await editor.bridge.getSource()).toContain('Before $x^2$ after');
		await page.keyboard.type('Z');
		const revealed = await editor.getBlockText(0);
		expect(revealed).toContain('Z$x^2$');
		expect(revealed).not.toContain('$x^2$Z');
	});

	test('walking the caret left out of the revealed source folds it back', async ({ page }) => {
		await editor.caretRightOfWidget();
		await page.keyboard.press('ArrowLeft'); // reveal at trailing edge
		await expect(editor.mathWidget).toHaveCount(0);

		// "$x^2$" is 5 chars: 5 steps reach the leading edge (still contained), the
		// 6th escapes left of the source and folds the reveal.
		for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');

		await expect(editor.mathWidget).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain('Before $x^2$ after');
	});

	test('Backspace right of the widget reveals; the next Backspace eats the closing delimiter', async ({
		page
	}) => {
		await editor.caretRightOfWidget();
		await page.keyboard.press('Backspace');

		// First Backspace reveals with no byte change — NOT a silent whole-widget delete.
		await expect(editor.mathWidget).toHaveCount(0);
		expect(await editor.getBlockText(0)).toContain('$x^2$');
		expect(await editor.bridge.getSource()).toContain('Before $x^2$ after');

		// Second Backspace visibly eats the trailing `$` in the revealed source.
		await page.keyboard.press('Backspace');
		const revealed = await editor.getBlockText(0);
		expect(revealed).toContain('$x^2 ');
		expect(revealed).not.toContain('$x^2$');
	});

	test('Delete left of the widget reveals at the leading edge; the next Delete eats the opening delimiter', async ({
		page
	}) => {
		await editor.caretLeftOfWidget();
		await page.keyboard.press('Delete');

		await expect(editor.mathWidget).toHaveCount(0);
		expect(await editor.getBlockText(0)).toContain('$x^2$');
		expect(await editor.bridge.getSource()).toContain('Before $x^2$ after');

		await page.keyboard.press('Delete');
		const revealed = await editor.getBlockText(0);
		expect(revealed).toContain('x^2$');
		expect(revealed).not.toContain('$x^2$');
	});

	test('Shift+ArrowLeft over the widget extends the selection without revealing', async ({
		page
	}) => {
		await editor.caretRightOfWidget();
		await page.keyboard.press('Shift+ArrowLeft');

		// A selection sweep never reveals: the widget stays rendered and a real
		// (non-collapsed) selection spans it.
		await expect(editor.mathWidget).toHaveCount(1);
		expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(false);
	});
});

test.describe('inline math: cross-block edge entry reveals the near-edge widget', () => {
	let editor: MathEntryPage;

	test.beforeEach(async ({ page }) => {
		editor = new MathEntryPage(page);
		await editor.gotoMath();
	});

	test('ArrowRight from the block above onto a block that STARTS with math reveals at the leading edge', async ({
		page
	}) => {
		await editor.loadContent('above para\n\n$x^2$ tail\n');
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowRight');

		await expect(editor.mathWidget).toHaveCount(0);
		await page.keyboard.type('Z');
		expect(await editor.getBlockText(1)).toContain('Z$x^2$');
	});

	test('ArrowLeft from the block below onto a block that ENDS with math reveals at the trailing edge', async ({
		page
	}) => {
		await editor.loadContent('lead $x^2$\n\nbelow para\n');
		await editor.focusBlockStart(1);
		await page.keyboard.press('ArrowLeft');

		await expect(editor.mathWidget).toHaveCount(0);
		await page.keyboard.type('Z');
		expect(await editor.getBlockText(0)).toContain('$x^2$Z');
	});
});
