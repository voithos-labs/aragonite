import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

// The fallback reports itself, and that report is half of what these cases check: a kind that
// rendered its raw text with no warning would be a silent loss of display.
test.describe('BlockHost no-component fallback', () => {
	test.use({ expectWarns: ['block-host'] });

	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('a kind with no component renders a visible raw block, not nothing', async ({ page }) => {
		await editor.loadContent('orphan text\n');

		await page.evaluate(() => (window as any).__test.makeBlockOrphan(0));
		await editor.waitForRenderFlush();

		const block = editor.getBlock(0);
		await expect(block).toBeVisible();
		await expect(block).toHaveText('orphan text');
		// The fallback reuses the plain editable element, not an empty wrapper.
		await expect(block).toHaveAttribute('contenteditable', 'true');
		await expect(block).toHaveClass(/raw-block/);
	});

	test('the orphan node still serializes — no silent display-drop', async ({ page }) => {
		await editor.loadContent('orphan text\n');

		await page.evaluate(() => (window as any).__test.makeBlockOrphan(0));
		await editor.waitForRenderFlush();

		expect(await editor.bridge.getSource()).toContain('orphan text');
	});
});
