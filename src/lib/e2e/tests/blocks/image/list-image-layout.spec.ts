import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

const LIST_IMAGE_DOC = '- ![pic|300x200](/test-fixtures/sample.png)\n- second\n';
const NESTED_LIST_IMAGE_DOC = '- outer\n  - ![pic|300x200](/test-fixtures/sample.png)\n';

async function waitForFirstImageLoaded(page: EditorPage['page']): Promise<void> {
	await page.waitForFunction(
		() => !!(document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
	);
}

test.describe('list/blockquote layout for image-bearing paragraphs', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('list-item marker bottom-aligns with the image (Obsidian-style)', async ({ page }) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);

		const marker = page.locator('.md-marker').first();
		const image = page.locator('[data-image-widget] img').first();

		const markerBox = await marker.boundingBox();
		const imageBox = await image.boundingBox();
		if (!markerBox || !imageBox) throw new Error('layout boxes missing');

		expect(
			Math.abs(markerBox.y + markerBox.height - (imageBox.y + imageBox.height))
		).toBeLessThanOrEqual(12);
	});

	test('image-only list item has no large trailing slack below the image', async ({ page }) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);

		const image = page.locator('[data-image-widget] img').first();
		const listItem = page.locator('.list-item-block').first();

		const imageBox = await image.boundingBox();
		const itemBox = await listItem.boundingBox();
		if (!imageBox || !itemBox) throw new Error('layout boxes missing');

		expect(itemBox.height).toBeLessThan(imageBox.height + 30);
	});

	test('nested list image inherits the parent list indent', async ({ page }) => {
		await editor.loadContent(NESTED_LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);

		const outerItem = page.locator('.list-item-block').first();
		const nestedImage = page.locator('[data-image-widget]').first();

		const outerBox = await outerItem.boundingBox();
		const imageBox = await nestedImage.boundingBox();
		if (!outerBox || !imageBox) throw new Error('layout boxes missing');

		expect(imageBox.x - outerBox.x).toBeGreaterThanOrEqual(12);
	});
});
