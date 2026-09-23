import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { openImageField } from './helpers';

// The image toolbar's alt field is a popover over the document and reports on `menuChange`; the
// toolbar a selected image shows is selection chrome and reports nothing.
// Requirements: `requirements/blocks/image/menu-change.md`.

test.describe('image: the alt field on menuChange', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
	});

	test('the toolbar alone reports nothing; the field reads true, and false on Escape', async ({
		page
	}) => {
		await page.evaluate(() => (window as any).__test.startMenuChangeCapture());
		await page.locator('[data-image-widget]').first().click();
		await expect(page.locator('.md-image-properties')).toBeVisible();

		const altInput = await openImageField(page);
		await altInput.click();
		await page.keyboard.press('Escape');
		await expect(page.locator('.md-image-properties input')).toHaveCount(0);

		expect(await page.evaluate(() => (window as any).__test.stopMenuChangeCapture())).toEqual([
			true,
			false
		]);
	});
});
