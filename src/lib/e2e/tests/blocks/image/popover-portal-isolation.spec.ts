import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { openImageField } from './helpers';

test.describe('image popover portal isolation', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// The popover was reparented INTO the widget, so keydown on its inputs bubbled through the
	// wrapping contenteditable and hit the "type while widget selected = replace image" branch.
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

	// Clicking between popover inputs fired the widget's pointerdown (the popover sat inside the
	// widget), re-dispatching `image-widget-select`; the reparent effect re-ran and the transient
	// detach blurred it shut.
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

	// Reparenting the overlay INTO the widget carried Svelte whitespace text nodes with it; on a
	// `display: block` widget those made an inline line-box that grew it by one line-height on
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

	// Anchored inside the widget DOM the popover sat on the first visual line of a list-item
	// paragraph, with the item's wrapped trailing text rendering alongside it; a portal at editor
	// root keeps its bounds independent of list-item flow.
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
