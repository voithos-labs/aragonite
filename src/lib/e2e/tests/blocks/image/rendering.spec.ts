import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('image rendering', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('standalone image renders widget', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toBeVisible();
		await expect(widget.locator('img')).toBeVisible();
	});

	test('mid-paragraph image renders widget', async ({ page }) => {
		await editor.loadContent('intro ![cat](/test-fixtures/sample.png) outro\n');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toBeVisible();
	});

	test('|400 dimension applies width attribute', async ({ page }) => {
		await editor.loadContent('![cat|400](/test-fixtures/sample.png)\n');
		const img = page.locator('[data-image-widget] img').first();
		await expect(img).toHaveAttribute('width', '400');
	});

	test('|400x300 applies width and height', async ({ page }) => {
		await editor.loadContent('![cat|400x300](/test-fixtures/sample.png)\n');
		const img = page.locator('[data-image-widget] img').first();
		await expect(img).toHaveAttribute('width', '400');
		await expect(img).toHaveAttribute('height', '300');
	});

	test('image in table cell renders alt-only (no widget)', async ({ page }) => {
		await editor.loadContent('| col |\n| --- |\n| ![cat](/test-fixtures/sample.png) |\n');
		const cellWidget = page.locator('.table-block [data-image-widget]');
		await expect(cellWidget).toHaveCount(0);
	});

	test('image in heading renders widget', async ({ page }) => {
		await editor.loadContent('# title with ![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toBeVisible();
	});

	test('broken URL gets md-image-broken class', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/nonexistent.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toHaveClass(/md-image-broken/, { timeout: 5000 });
	});

	// Pre-fix the broken-image styling overrode .md-image-widget's display:block
	// with display:inline-block, breaking the always-block-level rule:
	// trailing text after a broken image flowed on the same baseline instead
	// of wrapping below.
	test('broken image preserves block-level layout (trailing text wraps below)', async ({
		page
	}) => {
		await editor.loadContent('![bad](/test-fixtures/nonexistent.png)a\n');
		await page.waitForFunction(
			() => !!document.querySelector('[data-image-widget].md-image-broken')
		);
		const display = await page.evaluate(
			() => getComputedStyle(document.querySelector('[data-image-widget]')!).display
		);
		expect(display).toBe('block');

		const widgetBox = await page.locator('[data-image-widget]').first().boundingBox();
		const aTop = await page.evaluate(() => {
			const para = document.querySelector('[data-image-widget]')!.parentElement!;
			const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
			let node: Text | null = null;
			while ((node = walker.nextNode() as Text | null)) {
				if (node.textContent?.includes('a')) break;
			}
			if (!node) return null;
			const idx = node.textContent!.indexOf('a');
			const range = document.createRange();
			range.setStart(node, idx);
			range.setEnd(node, idx + 1);
			return range.getBoundingClientRect().top;
		});
		if (!widgetBox || aTop === null) throw new Error('layout box missing');
		expect(aTop).toBeGreaterThanOrEqual(widgetBox.y + widgetBox.height - 1);
	});
});
