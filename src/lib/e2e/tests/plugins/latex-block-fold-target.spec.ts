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

	// The confirmed swallow: with the FOLDED view holding focus the block had no keydown door at
	// all, so Mod+Z reached neither the leaf nor the editor root arm.
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

	// #161's own repro. The block forms as the second `$` lands, with the caret in its revealed
	// source. The draft is ephemeral: Mod+Z walks it back a keystroke at a time, and the press
	// after the last one returns the paragraph rather than flushing draft bytes into the document
	// the undo just restored. Exact text, not `toHaveText`: that matcher folds whitespace, and a
	// stray newline in the draft is one more local entry.
	test('undo from inside a just-minted reveal walks the draft back, then returns the paragraph', async ({
		page
	}) => {
		await editor.setup('\n');
		await editor.clickBlock(0);
		await page.keyboard.press('End');
		await editor.typeSlowly('$$');
		await editor.bridge.waitForSourceEquals('$$\n\n$$\n');
		await expect(editor.source).toBeFocused();

		await editor.typeSlowly('x^2');
		await expect.poll(() => editor.sourceText()).toBe('$$\nx^2\n$$');
		for (const remaining of ['$$\nx^\n$$', '$$\nx\n$$', '$$\n\n$$']) {
			await page.keyboard.press('ControlOrMeta+z');
			await expect.poll(() => editor.sourceText()).toBe(remaining);
		}
		expect(await editor.bridge.getSource()).toBe('$$\n\n$$\n');

		await page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceEquals('$$\n');
		expect(await editor.bridge.getSource()).not.toContain('x^2');
	});
});
