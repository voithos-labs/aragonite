import type { Page } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Shift+click while an image is selected whole: no caret exists to grow a range from, so the
// range grows from the image.
test.describe('image widget selection and Shift+click', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const overlay = (page: Page) => page.locator('[data-image-overlay]');

	// A point in the paragraph's text on the image's line: left of its first letter, or in the
	// empty space past its last one, where the browser puts the caret at the text's end.
	async function textEdgePoint(
		page: Page,
		edge: 'first' | 'last'
	): Promise<{ x: number; y: number }> {
		return page.evaluate((edge) => {
			const block = document
				.querySelector('[data-image-widget]')!
				.closest('[contenteditable="true"]')!;
			const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
			const texts: Text[] = [];
			for (let n = walker.nextNode(); n; n = walker.nextNode()) {
				const chrome = n.parentElement?.closest('[data-image-widget], .md-marker');
				if ((n as Text).data.trim() && !chrome) {
					texts.push(n as Text);
				}
			}
			const text = edge === 'first' ? texts[0] : texts[texts.length - 1];
			const range = document.createRange();
			const at = edge === 'first' ? 0 : text.data.length - 1;
			range.setStart(text, at);
			range.setEnd(text, at + 1);
			const rect = range.getBoundingClientRect();
			const x = edge === 'first' ? rect.left + 1 : rect.right + 30;
			return { x, y: rect.top + rect.height / 2 };
		}, edge);
	}

	const SHIFT_CLICK_PARAGRAPH = 'before ![pic|40x20](/test-fixtures/sample.png) after text here\n';

	test('Shift+click after a selected image selects from the image to the press', async ({
		page
	}) => {
		await editor.loadContent(SHIFT_CLICK_PARAGRAPH);
		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
		const point = await textEdgePoint(page, 'last');
		await page.keyboard.down('Shift');
		await page.mouse.click(point.x, point.y);
		await page.keyboard.up('Shift');
		await expect(overlay(page)).toHaveCount(0);
		const selected = await page.evaluate(() => window.getSelection()!.toString());
		expect(selected).toContain(' after text here');
		expect(selected).not.toContain('before');
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceEquals('before Z\n');
	});

	test('Shift+click before a selected image selects from the press to the image', async ({
		page
	}) => {
		await editor.loadContent(SHIFT_CLICK_PARAGRAPH);
		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
		const point = await textEdgePoint(page, 'first');
		await page.keyboard.down('Shift');
		await page.mouse.click(point.x, point.y);
		await page.keyboard.up('Shift');
		await expect(overlay(page)).toHaveCount(0);
		const selected = await page.evaluate(() => window.getSelection()!.toString());
		expect(selected).toContain('before ');
		expect(selected).not.toContain('after');
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceEquals('Z after text here\n');
	});

	// A list item's marker sits before raw 0, where the range has to start and still grow from
	// the press.
	test('Shift+click before a selected image in a list item keeps the press as the focus', async ({
		page
	}) => {
		await editor.loadContent('- ' + SHIFT_CLICK_PARAGRAPH);
		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
		const point = await textEdgePoint(page, 'first');
		await page.keyboard.down('Shift');
		await page.mouse.click(point.x, point.y);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.up('Shift');
		const selected = await page.evaluate(() => window.getSelection()!.toString());
		expect(selected.slice(0, 6)).toBe('efore ');
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceEquals('- bZ after text here\n');
	});
});
