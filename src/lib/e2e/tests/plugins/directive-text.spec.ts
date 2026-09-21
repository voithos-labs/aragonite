import { test, expect } from '../../fixtures';
import { PluginsPage, revealWidget, roundTripStable } from './helpers';

/**
 * The inline directive widget: `:name[label]{attrs}` renders as one atomic
 * `.directive-text-widget` and is edited by showing its source on focus, the same shared mechanism
 * the inline-math `$…$` widget uses (latex-inline.spec.ts). Unlike math, this widget renders its
 * source verbatim but dimmed, so `:abbr[HTML]` sits in the block text either way: what the tests
 * read is the widget count, 1 rendered and 0 while the source shows, not the source string itself.
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

	async revealByClick(): Promise<void> {
		await revealWidget(this.widget);
	}
}

test.describe('plugin inline directive: caret-entry / click reveal-source editing', () => {
	let editor: DirectiveTextPage;

	test.beforeEach(async ({ page }) => {
		editor = new DirectiveTextPage(page);
		await editor.gotoText();
	});

	test('the :name[label] span renders as an atomic source-bearing widget and round-trips', async ({
		page
	}) => {
		// What an atomic widget promises: the generic [data-inline-widget] attribute holds the raw
		// span in its data-source-* values, and the offset traversal counts it as no characters.
		await expect(editor.widget).toHaveAttribute('data-inline-widget', '');
		await expect(editor.widget).toHaveAttribute('data-source-start', '4');
		await expect(editor.widget).toHaveAttribute('data-source-end', '15');
		expect(await editor.bridge.getSource()).toContain('see :abbr[HTML] here');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('ArrowRight left of the widget reveals its source at the leading edge', async ({ page }) => {
		await editor.getBlock(0).click();
		await page.keyboard.press('Home');
		// "see " is 4 characters, so 4 steps reach the widget's leading edge and the fifth enters
		// it, which shows the source in place rather than selecting it invisibly first.
		for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');

		await expect(editor.widget).toHaveCount(0);
		// Showing the source only changes the view: the CST source is unchanged.
		expect(await editor.bridge.getSource()).toContain('see :abbr[HTML] here');
		// Caret at the leading edge: a typed character lands before the directive source.
		await page.keyboard.type('Z');
		expect(await editor.getBlockText(0)).toContain('Z:abbr[HTML]');
	});

	test('ArrowLeft right of the widget reveals its source at the trailing edge', async ({
		page
	}) => {
		await editor.getBlock(0).click();
		await page.keyboard.press('End');
		// " here" is 5 chars: 5 steps reach the widget's trailing edge; the 6th enters.
		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');

		await expect(editor.widget).toHaveCount(0);
		expect(await editor.bridge.getSource()).toContain('see :abbr[HTML] here');
		// Caret at the trailing edge: a typed character lands after the directive source.
		await page.keyboard.type('Z');
		expect(await editor.getBlockText(0)).toContain(':abbr[HTML]Z');
	});

	test('Backspace right of the widget reveals it, source intact (no whole-widget delete)', async ({
		page
	}) => {
		await editor.getBlock(0).click();
		await page.keyboard.press('End');
		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('Backspace');

		// The first Backspace shows the source with the directive fully intact.
		await expect(editor.widget).toHaveCount(0);
		expect(await editor.getBlockText(0)).toContain(':abbr[HTML]');
		expect(await editor.bridge.getSource()).toContain('see :abbr[HTML] here');
	});

	test('cross-block ArrowLeft from below onto a block ending with the widget reveals it', async ({
		page
	}) => {
		await editor.loadContent('lead :abbr[HTML]\n\nbelow\n');
		await expect(editor.widget).toHaveCount(1);
		await editor.focusBlockStart(1);
		await page.keyboard.press('ArrowLeft');

		await expect(editor.widget).toHaveCount(0);
		await page.keyboard.type('Z');
		expect(await editor.getBlockText(0)).toContain(':abbr[HTML]Z');
	});

	test('clicking the rendered widget reveals its source without touching the CST', async () => {
		expect(await editor.bridge.getSource()).toContain('see :abbr[HTML] here');
		await editor.revealByClick();
		// The widget is gone (count 0) and the raw span is editable text.
		expect(await editor.bridge.getSource()).toContain('see :abbr[HTML] here');
	});

	test('editing the revealed source and blurring commits the edit and one undo restores it', async ({
		page
	}) => {
		await editor.revealByClick();
		// The caret lands at the source's leading edge; step into the label, past `:abbr[`, and
		// insert a character so the edit is inside the directive source.
		for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.type('X');
		// Blur to the sibling paragraph: the edit commits and the widget renders again.
		await editor.getBlock(1).click();

		await expect(editor.widget).toHaveCount(1);
		await editor.bridge.waitForSourceContains(':abbr[XHTML] here');
		expect(await editor.bridge.getSource()).toContain('see :abbr[XHTML] here');
		expect(await roundTripStable(page)).toBe(true);

		// One undo restores the source as it was: the whole edit is a single entry.
		await editor.undo();
		await editor.bridge.waitForSourceContains(':abbr[HTML] here');
		await editor.bridge.waitForSourceNotContains('XHTML');
	});

	test('Escape discards the source edit and restores the rendered widget', async ({ page }) => {
		await editor.revealByClick();
		for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.type('X');
		// Escape renders the widget again from the untouched raw, discarding the edit.
		await page.keyboard.press('Escape');

		await expect(editor.widget).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain('see :abbr[HTML] here');
		expect(await editor.bridge.getSource()).not.toContain('XHTML');
	});
});
