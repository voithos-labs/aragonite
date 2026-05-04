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

	// Pre-fix: the absolute-positioning rule that bottom-left-anchors the
	// list-item ambient marker targeted every `.md-marker` direct child, so any
	// inline-render marker (hard-break `\`, escape, emphasis, link) at the top
	// level of an image-bearing list-item paragraph stacked over the ambient
	// `-` at the same coordinates — visually merging into a `\`/`-` blob.
	test('hard-break marker after image does not stack on the list-item ambient marker', async ({
		page
	}) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);

		const image = page.locator('[data-image-widget] img').first();
		const imageBox = await image.boundingBox();
		if (!imageBox) throw new Error('image box missing');

		// Click right of the image so click-snap parks the caret at image.end.
		await page.mouse.click(imageBox.x + imageBox.width + 20, imageBox.y + imageBox.height / 2);
		await page.keyboard.press('Shift+Enter');

		await page.waitForFunction(() => /\\\n/.test((window as any).__test.getSource() as string));

		const markerBoxes = await page.locator('.md-marker').evaluateAll((els) =>
			els.map((el) => {
				const r = el.getBoundingClientRect();
				return {
					ce: el.getAttribute('contenteditable'),
					text: el.textContent ?? '',
					x: r.x,
					y: r.y,
					w: r.width,
					h: r.height
				};
			})
		);
		const ambient = markerBoxes.find((m) => m.ce === 'false' && m.text.trim() === '-');
		const hardBreak = markerBoxes.find((m) => m.ce !== 'false' && m.text.includes('\\'));
		if (!ambient || !hardBreak) throw new Error(`marker pair missing: ${JSON.stringify(markerBoxes)}`);

		const overlapX = Math.max(0, Math.min(ambient.x + ambient.w, hardBreak.x + hardBreak.w) - Math.max(ambient.x, hardBreak.x));
		const overlapY = Math.max(0, Math.min(ambient.y + ambient.h, hardBreak.y + hardBreak.h) - Math.max(ambient.y, hardBreak.y));
		expect(overlapX === 0 || overlapY === 0).toBe(true);
	});

	// Sibling guarantee: a non-list paragraph mixing inline markers with an
	// image should not get the ambient-marker layout treatment at all — its
	// inline markers stay in normal flow rather than getting absolute-pinned to
	// the paragraph's bottom-left.
	test('inline markers in a non-list image paragraph stay in normal flow', async ({ page }) => {
		await editor.loadContent('*bold* ![pic|200](/test-fixtures/sample.png)\n');
		await waitForFirstImageLoaded(page);

		const positions = await page.locator('.md-marker').evaluateAll((els) =>
			els.map((el) => getComputedStyle(el).position)
		);
		expect(positions.every((p) => p === 'static')).toBe(true);
	});
});
