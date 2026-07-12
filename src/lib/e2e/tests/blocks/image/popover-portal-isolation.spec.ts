import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('image popover portal isolation', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Regression: the popover was reparented INTO the widget, so keydown on
	// popover inputs bubbled up through the contenteditable that wraps the
	// widget. The contenteditable's "type while widget selected = replace
	// image" branch fired on every keystroke, deleting the image.
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

	// Regression: clicking from one popover input to another fired the
	// widget's pointerdown listener (because the popover sat inside the widget
	// after reparenting), which re-dispatched `image-widget-select`. The
	// reparent effect then re-ran, transiently detaching the popover from the
	// DOM and triggering a `relatedTarget=null` blur that dismissed it.
	test('clicking between popover input fields keeps the popover open', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await page.locator('.md-image-properties input').nth(1).click();
		await page.locator('.md-image-properties input').nth(0).click();
		await page.locator('.md-image-properties input').nth(2).click();
		await expect(page.locator('.md-image-properties')).toBeVisible();
	});

	// Regression: the overlay was previously reparented INTO the widget along
	// with Svelte-generated whitespace text nodes. The widget is `display:
	// block`, so those text nodes created an inline line-box that grew the
	// widget by one line-height when the popover opened — visible as a
	// vertical jump of every block below the image.
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

	// Regression: the popover was anchored inside the widget DOM, which sits
	// on the first visual line of a list-item paragraph. The list item's
	// trailing inline text wrapped to the line below the image and rendered
	// alongside (or under) the popover — reading as "field labels outside the
	// popover bounds." A position-portal at editor root keeps the popover's
	// own bounds independent of list-item flow.
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
