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

	test('preview-block has no new violations', async ({ page }) => {
		// Live editing with markers hidden by focus-keyed CSS, plus rendered bullets on unfocused
		// list items: a different set of elements and contrasts from reading and source.
		await editor.loadContent(DEFAULT_CONTENT);
		await page.getByTestId('preview-block-toggle').click();
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'preview-block');
		await editor.waitForRenderFlush();
		await expectNoNewA11yViolations(page, 'preview-block');
	});

	test('preview-inline has no new violations', async ({ page }) => {
		// This mode marks each construct's markers with a data attribute and hides them until the
		// caret is near, so those attributes and the shown spans get their own axe pass.
		await editor.loadContent(DEFAULT_CONTENT);
		await page.getByTestId('preview-inline-toggle').click();
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'preview-inline');
		await editor.waitForRenderFlush();
		await expectNoNewA11yViolations(page, 'preview-inline');
	});

	test('cross-block selection announces via live region and has no new violations', async ({
		page
	}) => {
		await editor.loadContent('alpha\n\nbeta\n\ngamma\n');
		await editor.focusBlockStart(0);
		await page.keyboard.press('ControlOrMeta+Shift+End');
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

	test('the live-mode link card has no new violations while open', async ({ page }) => {
		// The card is anchored inside `.editor`, so axe's `include('.editor')` scans it unchanged:
		// a role=dialog with a name, a labeled text field, and two named buttons over the
		// editor's own theme colors.
		await page.evaluate(() => (window as any).__test.setPresentationMode('live'));
		await editor.loadContent('Visit [example](https://example.com) now.\n');
		await editor.waitForRenderFlush();
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'live');

		await page.locator('a.md-link-content').first().click();
		await expect(page.locator('[data-link-card]')).toBeVisible();

		await expectNoNewA11yViolations(page, 'link-card');
	});

	test('keyboard reorder announces via live region and has no new violations', async ({ page }) => {
		await editor.loadContent('alpha\n\nbeta\n\ngamma\n');
		await editor.clickBlock(0);
		await page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceMatches(/beta[\s\S]*alpha[\s\S]*gamma/);
		await expect(page.locator('.editor-sr-live-reorder')).toContainText('Moved block to position');
		await expectNoNewA11yViolations(page, 'reorder-announce');
	});

	// A reader moving block to block tells them apart by these names; a renamed label is a
	// visible diff here.
	test('each block exposes its kind as its accessible name', async ({ page }) => {
		await editor.loadContent('## Title\n\nPlain text\n\n```js\ncode\n```\n\n- item\n\n---\n');
		await editor.waitForRenderFlush();
		const surface = (path: number[], selector: string) =>
			page.locator(`[data-block-path='${JSON.stringify(path)}'] ${selector}`).first();

		await expect(surface([0], '.text-editable-block')).toHaveAccessibleName('Heading level 2');
		await expect(surface([1], '.text-editable-block')).toHaveAccessibleName('Paragraph');
		await expect(surface([2], '.code-block')).toHaveAccessibleName('Code block, js');
		await expect(surface([3, 0, 0], '.text-editable-block')).toHaveAccessibleName('Paragraph');
		await expect(surface([4], '[data-whole-block-input]')).toHaveAccessibleName('Divider');
		await expect(page.getByRole('separator')).toHaveCount(1);
	});
});
