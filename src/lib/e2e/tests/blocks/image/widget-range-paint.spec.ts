import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

const INLINE_IMAGE_DOC = 'lead text ![pic](/test-fixtures/sample.png) trail text\n';

test.describe('inline image range-selection highlight', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+arrow across inline image adds md-widget-selected', async ({ page }) => {
		await editor.loadContent(INLINE_IMAGE_DOC);
		await editor.focusBlockStart(0);
		// "lead text " is 10 chars; jump past it then extend across the widget.
		for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Shift+ArrowRight');
		await expect(page.locator('[data-image-widget].md-widget-selected')).toHaveCount(1);
	});

	test('collapsing the selection removes the highlight', async ({ page }) => {
		await editor.loadContent(INLINE_IMAGE_DOC);
		await editor.focusBlockStart(0);
		for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Shift+ArrowRight');
		await expect(page.locator('[data-image-widget].md-widget-selected')).toHaveCount(1);

		await page.keyboard.press('ArrowRight');
		await expect(page.locator('[data-image-widget].md-widget-selected')).toHaveCount(0);
	});

	test('cross-block selection covering the image does not add md-widget-selected', async ({
		page
	}) => {
		await editor.loadContent(
			'before paragraph.\n\nlead ![pic](/test-fixtures/sample.png) trail\n\nafter paragraph.\n'
		);
		await editor.focusBlockEnd(0);
		// Extend down two paragraphs — crosses the image paragraph entirely.
		await page.keyboard.press('Shift+ArrowDown');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await expect(page.locator('.selection-overlay')).not.toHaveCount(0);
		await expect(page.locator('[data-image-widget].md-widget-selected')).toHaveCount(0);
	});

	test('click-selecting the widget does not add md-widget-selected', async ({ page }) => {
		await editor.loadContent(INLINE_IMAGE_DOC);
		await page.locator('[data-image-widget]').first().click();
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		await expect(page.locator('[data-image-widget].md-widget-selected')).toHaveCount(0);
	});
});
