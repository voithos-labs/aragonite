import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

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
		const urlInput = page.locator('.md-image-properties input').nth(0);
		await urlInput.click();
		await page.keyboard.type('?v=2');
		await expect(page.locator('[data-image-widget]')).toBeVisible();
		await expect(page.locator('.md-image-properties')).toBeVisible();
		expect(await urlInput.inputValue()).toContain('?v=2');
	});

	// Clicking between popover inputs fired the widget's pointerdown (the popover sat inside the
	// widget), re-dispatching `image-widget-select`; the reparent effect re-ran and the transient
	// detach blurred it shut.
	test('clicking between popover input fields keeps the popover open', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await page.locator('.md-image-properties input').nth(1).click();
		await page.locator('.md-image-properties input').nth(0).click();
		await page.locator('.md-image-properties input').nth(2).click();
		await expect(page.locator('.md-image-properties')).toBeVisible();
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
		const popover = page.locator('.md-image-properties').first();
		await popover.waitFor({ state: 'visible' });

		const popoverBox = (await popover.boundingBox())!;
		const labelBoxes = await page.locator('.md-image-properties label > span').evaluateAll((els) =>
			els.map((el) => {
				const r = el.getBoundingClientRect();
				return { x: r.x, right: r.x + r.width, y: r.y, bottom: r.y + r.height };
			})
		);
		const popoverRight = popoverBox.x + popoverBox.width;
		const popoverBottom = popoverBox.y + popoverBox.height;
		for (const lb of labelBoxes) {
			expect(lb.x).toBeGreaterThanOrEqual(popoverBox.x - 1);
			expect(lb.right).toBeLessThanOrEqual(popoverRight + 1);
			expect(lb.y).toBeGreaterThanOrEqual(popoverBox.y - 1);
			expect(lb.bottom).toBeLessThanOrEqual(popoverBottom + 1);
		}
	});
});
