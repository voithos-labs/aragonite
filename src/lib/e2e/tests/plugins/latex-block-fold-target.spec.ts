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

	// #161's own repro. The draft is ephemeral, so undo must return the paragraph rather than
	// flushing those bytes into the document the undo just restored.
	test('undo from inside a just-minted reveal returns the paragraph, draft and all', async ({
		page
	}) => {
		await editor.setup('\n');
		await editor.clickBlock(0);
		await page.keyboard.press('End');
		await editor.typeSlowly('$$');
		await editor.bridge.waitForSourceContains('$$');
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('$$\n\n$$\n');

		await editor.typeSlowly('x^2');
		await page.keyboard.press('ControlOrMeta+z');

		await editor.bridge.waitForSourceEquals('$$\n');
		expect(await editor.bridge.getSource()).not.toContain('x^2');
	});
});
