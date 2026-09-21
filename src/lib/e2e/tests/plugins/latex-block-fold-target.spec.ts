import { test, expect } from '../../fixtures';
import { BlockMathPage } from './latex-reveal-helpers';

// Requirements: e2e/requirements/plugins/latex-block-fold-target.md.

const DOC = '$$\nold\n$$\n\ntail\n';

class MathFoldPage extends BlockMathPage {
	async setup(source = DOC): Promise<void> {
		await this.gotoPlugins('mathblock');
		await this.loadContent(source);
	}
}

test.describe('a render-primary block folds onto the document it opened over', () => {
	let editor: MathFoldPage;

	test.beforeEach(async ({ page }) => {
		editor = new MathFoldPage(page);
		await editor.setup();
	});

	test('a revealed edit commits on blur as one undo entry', async ({ page }) => {
		await editor.render.click();
		await expect(editor.source).toBeFocused();
		await page.keyboard.press('ControlOrMeta+a');
		await editor.typeSlowly('$$\nnew\n$$');

		await editor.clickBlock(1);
		await editor.bridge.waitForSourceEquals('$$\nnew\n$$\n\ntail\n');
	});

	// The confirmed swallow: with the rendered view holding focus the block had no keydown handler
	// at all, so Mod+Z reached neither the block nor the editor root.
	test('Mod+Z reaches the stack while the folded view holds focus', async ({ page }) => {
		await editor.render.click();
		await expect(editor.source).toBeFocused();
		await page.keyboard.press('ControlOrMeta+a');
		await editor.typeSlowly('$$\nnew\n$$');
		await editor.clickBlock(1);
		await editor.bridge.waitForSourceEquals('$$\nnew\n$$\n\ntail\n');

		await editor.render.focus();
		await page.keyboard.press('ControlOrMeta+z');

		await editor.bridge.waitForSourceEquals(DOC);
	});

	// The reproduction from #161. The block forms as the second `$` lands, with the caret in its
	// open source. That draft is uncommitted: Mod+Z steps back through it one typing burst at a
	// time, the document's own granularity, and the key after the last one brings the paragraph
	// back rather than pushing draft bytes into the document the undo just restored. Exact text
	// rather than `toHaveText`, which collapses whitespace, since a stray newline in the draft is
	// one more entry of its own.
	test('undo from inside a just-minted reveal walks the draft back, then returns the paragraph', async ({
		page
	}) => {
		await editor.setup('\n');
		await editor.clickBlock(0);
		await page.keyboard.press('End');
		await editor.typeSlowly('$$');
		await editor.bridge.waitForSourceEquals('$$\n\n$$\n');
		await expect(editor.source).toBeFocused();

		// Two bursts with a pause between them, so the draft holds two entries and not five.
		await editor.typeSlowly('x^');
		await editor.waitForUndoBatchFlush();
		await editor.typeSlowly('2');
		await expect.poll(() => editor.sourceText()).toBe('$$\nx^2\n$$');
		for (const remaining of ['$$\nx^\n$$', '$$\n\n$$']) {
			await page.keyboard.press('ControlOrMeta+z');
			await expect.poll(() => editor.sourceText()).toBe(remaining);
		}
		expect(await editor.bridge.getSource()).toBe('$$\n\n$$\n');

		await page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceEquals('$$\n');
		expect(await editor.bridge.getSource()).not.toContain('x^2');
	});
});
