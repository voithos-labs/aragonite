import { test, expect } from '../../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';
import { textRunRect } from '../../../text-runs';
import { PluginsPage } from '../../plugins/helpers';
import { waitForFirstImageLoaded } from './helpers';

const LIST_IMAGE_DOC = '- ![pic|300x200](/test-fixtures/sample.png)\n- second\n';
const NESTED_LIST_IMAGE_DOC = '- outer\n  - ![pic|300x200](/test-fixtures/sample.png)\n';
const PIC = '![pic|300x200](/test-fixtures/sample.png)';
const WRAPPED_LIST_IMAGE_DOCS = {
	link: '- [![pic|300x200](/test-fixtures/sample.png)](https://example.com)\n',
	emphasis: '- *![pic|300x200](/test-fixtures/sample.png)*\n'
};

const AMBIENT_MARKER = '.text-editable-block > .md-marker[contenteditable="false"]';

async function markerCellBox(page: Page) {
	return (await page.locator('.list-item-block > .list-item-marker').first().boundingBox())!;
}

test.describe('list/blockquote layout for image-bearing paragraphs', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('list-item marker top-aligns with the image', async ({ page }) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);

		const marker = page.locator('.md-marker').first();
		const image = page.locator('[data-image-widget] img').first();

		const markerBox = await marker.boundingBox();
		const imageBox = await image.boundingBox();
		if (!markerBox || !imageBox) throw new Error('layout boxes missing');

		expect(Math.abs(markerBox.y - imageBox.y)).toBeLessThanOrEqual(12);
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

	// The widget sits one level deeper per wrapping construct, past a child-combinator `:has(> …)`;
	// the wrapper's opening markers keep a line box above the picture, hence the looser tolerance.
	for (const [shape, doc] of Object.entries(WRAPPED_LIST_IMAGE_DOCS)) {
		test(`${shape}-wrapped list image keeps the ambient marker pinned`, async ({ page }) => {
			await editor.loadContent(doc);
			await waitForFirstImageLoaded(page);

			const cell = page.locator('.list-item-block > .list-item-marker').first();
			const markerBox = await cell.boundingBox();
			const imageBox = await page.locator('[data-image-widget] img').first().boundingBox();
			if (!markerBox || !imageBox) throw new Error('layout boxes missing');

			// Held at the top by the picture rule, not merely near: under an inline-block `<a>` the
			// marker and image land close anyway, so geometry alone cannot tell the link shape apart.
			expect(await cell.evaluate((el) => getComputedStyle(el).alignSelf)).toBe('flex-start');
			expect(Math.abs(markerBox.y - imageBox.y)).toBeLessThanOrEqual(45);
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

	// The rule holding the list item's `- ` marker at the picture's top must not reach the inline
	// markers in the paragraph, or they leave its flow.
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

	// Text on the picture's line is what the marker numbers, so it sits on that line's baseline.
	for (const mode of ['source', 'live'] as const) {
		for (const [source, word] of [
			[`- lead ${PIC} after text`, 'lead'],
			[`- ${PIC} after text`, 'after']
		]) {
			test(`${mode}: \`${source.replace(PIC, '![pic]')}\` puts the marker beside the text`, async ({
				page
			}) => {
				await editor.setPresentationMode(mode);
				await editor.loadContent(`${source}\n`);
				await waitForFirstImageLoaded(page);
				const marker = await markerCellBox(page);
				const text = await textRunRect(page, word, { path: [0, 0, 0] });
				const middle = marker.y + marker.height / 2;
				expect(middle, `marker ${middle} vs text ${text.top}..${text.bottom}`).toBeGreaterThan(
					text.top
				);
				expect(middle).toBeLessThan(text.bottom);
			});
		}
	}

	// The sibling case: an image paragraph outside a list gets no marker layout at all.
	test('inline markers in a non-list image paragraph stay in normal flow', async ({ page }) => {
		await editor.loadContent('*bold* ![pic|200](/test-fixtures/sample.png)\n');
		await waitForFirstImageLoaded(page);

		const positions = await page
			.locator('.md-marker')
			.evaluateAll((els) => els.map((el) => getComputedStyle(el).position));
		expect(positions.every((p) => p === 'static')).toBe(true);
	});
});

// A container that draws its marker inside its first paragraph (a footnote definition's `[^1]: `)
// follows the same rule as a list item's.
test.describe('an ambient marker beside a picture', () => {
	for (const mode of ['source', 'live'] as const) {
		test(`${mode}: a picture alone on the first line keeps the marker at its top`, async ({
			page
		}) => {
			const editor = new PluginsPage(page);
			await editor.gotoPlugins('footnotes');
			await editor.setPresentationMode(mode);
			await editor.loadContent(`see[^1]

[^1]: ${PIC}
`);
			await waitForFirstImageLoaded(page);
			const marker = (await page.locator(AMBIENT_MARKER).first().boundingBox())!;
			const image = (await page.locator('[data-image-widget] img').first().boundingBox())!;
			expect(
				Math.abs(marker.y - image.y),
				`marker ${marker.y} vs image ${image.y}`
			).toBeLessThanOrEqual(12);
		});

		test(`${mode}: text on the picture's line keeps the marker beside it`, async ({ page }) => {
			const editor = new PluginsPage(page);
			await editor.gotoPlugins('footnotes');
			await editor.setPresentationMode(mode);
			await editor.loadContent(`see[^1]

[^1]: ${PIC} after text
`);
			await waitForFirstImageLoaded(page);
			const marker = (await page.locator(AMBIENT_MARKER).first().boundingBox())!;
			const text = await textRunRect(page, 'after', { path: [1] });
			const middle = marker.y + marker.height / 2;
			expect(middle, `marker ${middle} vs text ${text.top}..${text.bottom}`).toBeGreaterThan(
				text.top
			);
			expect(middle).toBeLessThan(text.bottom);
		});
	}
});
