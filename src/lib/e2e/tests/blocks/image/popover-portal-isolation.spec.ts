import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { openImageField } from './helpers';

test.describe('image popover portal isolation', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Moving the popover inside the widget makes keydown on its inputs bubble through the wrapping
	// contenteditable and hit the "typing while the widget is selected replaces it" branch.
	test('typing into a popover input does not delete the image', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const altInput = await openImageField(page);
		await altInput.click();
		await page.keyboard.type(' v2');
		await expect(page.locator('[data-image-widget]')).toBeVisible();
		await expect(page.locator('.md-image-properties')).toBeVisible();
		expect(await altInput.inputValue()).toContain(' v2');
	});

	// With the popover inside the widget, clicking between its inputs fires the widget's
	// `pointerdown` and re-dispatches `image-widget-select`, so the move effect runs again and the
	// brief detach blurs the field shut.
	test('toggling the alt field keeps the toolbar open', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const altButton = page
			.locator('.md-image-properties')
			.getByRole('button', { name: 'Alt text' });
		await (await openImageField(page)).click();
		await altButton.click();
		await expect(page.locator('.md-image-properties input')).toHaveCount(0);
		await (await openImageField(page)).click();
		await expect(page.locator('.md-image-properties')).toBeVisible();
		await expect(page.locator('.md-image-properties input')).toBeFocused();
	});

	// Moving the overlay inside the widget carries Svelte's whitespace text nodes with it, and on a
	// `display: block` widget those make an inline line box that grows it by one line height on
	// open.
	test('opening popover does not shift the widget or the block below it', async ({ page }) => {
		await editor.loadContent('intro\n\n![cat|400x200](/test-fixtures/sample.png)\n\nfollowing.\n');
		const widget = page.locator('[data-image-widget]').first();
		await page.waitForFunction(
			() => !!(document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
		);
		const widgetTopBefore = (await widget.boundingBox())!.y;
		const widgetHeightBefore = (await widget.boundingBox())!.height;
		const belowYBefore = (await editor.getBlock(2).boundingBox())!.y;

		await widget.click();
		await page.locator('.md-image-properties').waitFor({ state: 'visible' });

		const widgetTopAfter = (await widget.boundingBox())!.y;
		const widgetHeightAfter = (await widget.boundingBox())!.height;
		const belowYAfter = (await editor.getBlock(2).boundingBox())!.y;

		expect(widgetTopAfter).toBe(widgetTopBefore);
		expect(widgetHeightAfter).toBe(widgetHeightBefore);
		expect(belowYAfter).toBe(belowYBefore);
	});

	// Anchored inside the widget's DOM the popover sits on the first visual line of a list-item
	// paragraph, with the item's wrapped trailing text beside it; rendering it at the editor root
	// keeps its bounds out of the list item's flow.
	test('popover field labels stay inside popover bounds when image is in a list', async ({
		page
	}) => {
		await editor.loadContent(
			'- ![dome|300x200](/test-fixtures/sample.png) trailing text in list item\n- ![sun|300x200](/test-fixtures/sample.png)\n'
		);
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const input = await openImageField(page);
		const field = page.locator('.md-image-field');

		const fieldBox = (await field.boundingBox())!;
		const inputBox = (await input.boundingBox())!;
		expect(inputBox.x).toBeGreaterThanOrEqual(fieldBox.x - 1);
		expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(fieldBox.x + fieldBox.width + 1);
		expect(inputBox.y).toBeGreaterThanOrEqual(fieldBox.y - 1);
		expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(fieldBox.y + fieldBox.height + 1);
	});
});
