import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { waitForFirstImageLoaded } from './helpers';

const LIST_IMAGE_DOC = '- ![pic|300x200](/test-fixtures/sample.png)\n- second\n';
const NESTED_LIST_IMAGE_DOC = '- outer\n  - ![pic|300x200](/test-fixtures/sample.png)\n';
const WRAPPED_LIST_IMAGE_DOCS = {
	link: '- [![pic|300x200](/test-fixtures/sample.png)](https://example.com)\n',
	emphasis: '- *![pic|300x200](/test-fixtures/sample.png)*\n'
};

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

	// The renderer nests the widget one level deeper per wrapping construct (`em`, `strong`, `s`, a
	// link's anchor), so a child-combinator `:has(> …)` misses them; the wrapper's own markers keep
	// a trailing line box, hence the looser tolerance.
	for (const [shape, doc] of Object.entries(WRAPPED_LIST_IMAGE_DOCS)) {
		test(`${shape}-wrapped list image keeps the ambient marker pinned`, async ({ page }) => {
			await editor.loadContent(doc);
			await waitForFirstImageLoaded(page);

			const marker = page.locator('.md-marker[contenteditable="false"]').first();
			const markerBox = await marker.boundingBox();
			const imageBox = await page.locator('[data-image-widget] img').first().boundingBox();
			if (!markerBox || !imageBox) throw new Error('layout boxes missing');

			// Pinned at all, not merely near: under an inline-block anchor the marker and the image
			// land close together anyway, so geometry alone cannot tell the link shape apart.
			expect(await marker.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
			expect(
				Math.abs(markerBox.y + markerBox.height - (imageBox.y + imageBox.height))
			).toBeLessThanOrEqual(45);
		});
	}

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

	// The rule that pins the list-item ambient marker bottom-left once targeted every `.md-marker`
	// direct child, so inline markers inside an image-bearing list-item paragraph stacked on the
	// ambient `-`.
	test('inline emphasis markers in a list-item image paragraph stay in normal flow', async ({
		page
	}) => {
		await editor.loadContent('- *bold* ![pic|300](/test-fixtures/sample.png)\n');
		await waitForFirstImageLoaded(page);

		const inlineMarkerPositions = await page
			.locator('.md-marker:not([contenteditable="false"])')
			.evaluateAll((els) => els.map((el) => getComputedStyle(el).position));
		expect(inlineMarkerPositions.length).toBeGreaterThan(0);
		expect(inlineMarkerPositions.every((p) => p === 'static')).toBe(true);
	});

	// Sibling guarantee: a non-list image paragraph gets no ambient-marker layout treatment at all.
	test('inline markers in a non-list image paragraph stay in normal flow', async ({ page }) => {
		await editor.loadContent('*bold* ![pic|200](/test-fixtures/sample.png)\n');
		await waitForFirstImageLoaded(page);

		const positions = await page
			.locator('.md-marker')
			.evaluateAll((els) => els.map((el) => getComputedStyle(el).position));
		expect(positions.every((p) => p === 'static')).toBe(true);
	});
});
