import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { expectNoNewA11yViolations } from '../../a11y/axe-helper';
import { DEFAULT_CONTENT } from '../../test-content';

test.describe('editor accessibility (axe baseline-ratchet)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('default content has no new violations', async ({ page }) => {
		await editor.loadContent(DEFAULT_CONTENT);
		await editor.waitForRenderFlush();
		await expectNoNewA11yViolations(page, 'default');
	});

	test('reading mode has no new violations', async ({ page }) => {
		// Reading mode is axe-relevant on its own: contenteditable=false + aria-readonly,
		// markers hidden by CSS, synthesized bullets, and visible-undimmed ordered numbers.
		await editor.loadContent(DEFAULT_CONTENT);
		await page.getByTestId('presentation-toggle').click();
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'reading');
		await editor.waitForRenderFlush();
		await expectNoNewA11yViolations(page, 'reading-mode');
	});

	test('cross-block selection announces via live region and has no new violations', async ({
		page
	}) => {
		await editor.loadContent('alpha\n\nbeta\n\ngamma\n');
		await editor.focusBlockStart(0);
		await page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);
		await editor.waitForRenderFlush();
		await expect(page.locator('.editor-sr-live')).toContainText('Selected');
		await expectNoNewA11yViolations(page, 'cross-block-selection');
	});

	test('failed-block fallback (Wave 1) has no new violations', async ({ page }) => {
		await editor.loadContent('alpha\n\nbeta\n\ngamma\n');
		await page.evaluate(() => (window as any).__test.makeBlockThrowOnRender(1));
		await editor.waitForRenderFlush();
		await expect(page.locator('[data-failed-block]')).toHaveCount(1);
		await expectNoNewA11yViolations(page, 'failed-block');
	});

	test('blocked-scheme inert link (Wave 2) has no new violations', async ({ page }) => {
		await editor.loadContent('Click [x](javascript:alert(1)) now.\n');
		await editor.waitForRenderFlush();
		await expect(page.locator('span.md-link-blocked')).toHaveCount(1);
		await expectNoNewA11yViolations(page, 'blocked-link');
	});

	test('keyboard reorder announces via live region and has no new violations', async ({ page }) => {
		await editor.loadContent('alpha\n\nbeta\n\ngamma\n');
		await editor.clickBlock(0);
		await page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceMatches(/beta[\s\S]*alpha[\s\S]*gamma/);
		await expect(page.locator('.editor-sr-live-reorder')).toContainText('Moved block to position');
		await expectNoNewA11yViolations(page, 'reorder-announce');
	});
});
