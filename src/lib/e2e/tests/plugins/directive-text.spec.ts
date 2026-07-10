import { test, expect } from '../../fixtures';
import { PluginsPage, revealWidget, roundTripStable } from './helpers';

/**
 * Text-tier directive widget: `:name[label]{attrs}` renders as an atomic
 * `.directive-text-widget` and edits via source-reveal-on-focus — the same shared
 * primitive the inline-math `$…$` widget uses (latex-inline.spec.ts). The reveal
 * swap and commit re-render are driven through real mouse/keyboard only.
 *
 * DOM assumption for the reveal signal: unlike math (which renders KaTeX, so the
 * `$…$` source appears in block text only once revealed), this widget renders its
 * source verbatim-but-dimmed, so the `:abbr[HTML]` string is in the block text in
 * BOTH states. The reveal signal is therefore the widget COUNT (1 rendered → 0
 * revealed), not the presence of the source string.
 */

const SEED = 'see :abbr[HTML] here\n\nNext\n';

class DirectiveTextPage extends PluginsPage {
	async gotoText(): Promise<void> {
		await this.gotoPlugins();
		await this.loadContent(SEED);
		await expect(this.widget).toHaveCount(1);
	}

	get widget() {
		return this.page.locator('.directive-text-widget');
	}

	/** Click the rendered widget to reveal its source, settling on the swap. */
	async revealByClick(): Promise<void> {
		await revealWidget(this.widget);
	}
}

test.describe('plugin inline directive: select → reveal-source editing', () => {
	let editor: DirectiveTextPage;

	test.beforeEach(async ({ page }) => {
		editor = new DirectiveTextPage(page);
		await editor.gotoText();
	});

	test('the :name[label] span renders as an atomic source-bearing widget and round-trips', async ({
		page
	}) => {
		// Atomic-widget contract: the generic [data-inline-widget] marker carries the
		// raw span via data-source-*; the offset walk counts 0 chars for the island.
		await expect(editor.widget).toHaveAttribute('data-inline-widget', '');
		await expect(editor.widget).toHaveAttribute('data-source-start', '4');
		await expect(editor.widget).toHaveAttribute('data-source-end', '15');
		expect(await editor.bridge.getSource()).toContain('see :abbr[HTML] here');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('ArrowRight selects the widget, then steps over its trailing edge', async ({ page }) => {
		await editor.getBlock(0).click();
		await page.keyboard.press('Home');
		// "see " is 4 chars: 4 steps reach the widget's left edge, the 5th selects it.
		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
		// The next press steps over the atom to its trailing edge, so a typed char lands
		// immediately after the source — not inside the folded widget.
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('X');

		await editor.bridge.waitForSourceContains(':abbr[HTML]X here');
		await expect(editor.widget).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain('see :abbr[HTML]X here');
	});

	test('keyboard-selecting the widget and pressing Enter reveals the source', async ({ page }) => {
		await editor.getBlock(0).click();
		await page.keyboard.press('Home');
		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Enter');

		await expect(editor.widget).toHaveCount(0);
		// Reveal is a view toggle — the source has not changed.
		expect(await editor.bridge.getSource()).toContain('see :abbr[HTML] here');
	});

	test('clicking the rendered widget reveals its source without touching the CST', async () => {
		expect(await editor.bridge.getSource()).toContain('see :abbr[HTML] here');
		await editor.revealByClick();
		// The opaque widget is gone (count 0); the raw span is now editable text.
		expect(await editor.bridge.getSource()).toContain('see :abbr[HTML] here');
	});

	test('editing the revealed source and blurring commits the edit and one undo restores it', async ({
		page
	}) => {
		await editor.revealByClick();
		// The caret lands at the source's leading edge; step into the label ( past
		// `:abbr[` ) and insert a char so the edit is inside the directive source.
		for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.type('X');
		// Blur to the sibling paragraph → the reveal commits and the widget re-forms.
		await editor.getBlock(1).click();

		await expect(editor.widget).toHaveCount(1);
		await editor.bridge.waitForSourceContains(':abbr[XHTML] here');
		expect(await editor.bridge.getSource()).toContain('see :abbr[XHTML] here');
		expect(await roundTripStable(page)).toBe(true);

		// One undo restores the pre-edit source — the whole reveal edit is one entry.
		await editor.undo();
		await editor.bridge.waitForSourceContains(':abbr[HTML] here');
		await editor.bridge.waitForSourceNotContains('XHTML');
	});

	test('Escape discards the source edit and restores the rendered widget', async ({ page }) => {
		await editor.revealByClick();
		for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.type('X');
		// Escape reverts to the rendered widget from the untouched raw — edit discarded.
		await page.keyboard.press('Escape');

		await expect(editor.widget).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain('see :abbr[HTML] here');
		expect(await editor.bridge.getSource()).not.toContain('XHTML');
	});
});
