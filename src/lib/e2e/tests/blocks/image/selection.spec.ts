import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { selectedImageCaret, HIDDEN_AT_IMAGE_END, waitForFirstImageLoaded } from './helpers';
import { multiClickElement } from '../../../multi-click';
import { edgeKey } from '../../../platform-keys';
import { skipUnlessSupported } from '../../../browser-engine';

test.describe('image widget selection', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// The overlay rendered at the widget's bounds is the only outward sign that it is selected.
	const overlay = (page: import('@playwright/test').Page) => page.locator('[data-image-overlay]');

	test('click on widget enters selected state', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
	});

	test('click outside widget exits selected state', async ({ page }) => {
		await editor.loadContent('intro\n\n![cat](/test-fixtures/sample.png)\n');
		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
		await page.locator('.paragraph-block').first().click();
		await expect(overlay(page)).toHaveCount(0);
	});

	test('ArrowLeft from right boundary enters selected state', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)trail\n');
		await editor.focusBlockEnd(0);
		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');
		await expect(overlay(page)).toBeVisible();
	});

	test('ArrowLeft while selected jumps to left boundary and deselects', async ({ page }) => {
		await editor.loadContent('lead![cat](/test-fixtures/sample.png)\n');
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');
		await expect(overlay(page)).toHaveCount(0);
		await editor.typeText('X');
		expect(await editor.bridge.getSource()).toContain('leadX![cat]');
	});

	// The paragraph keeps focus while its image is selected, so the browser puts a caret at its
	// start on the next mouse input of any kind; the editor keeps it at the image's end, unshown.
	const IMAGE_PARAGRAPH = 'before ![pic|120x80](/test-fixtures/sample.png) after\n';
	// The editor's read answers the image's end, where the click left it.
	const imageEnd = { path: [0], offset: 'before ![pic|120x80](/test-fixtures/sample.png)'.length };
	const onlyTheImageEnd = [HIDDEN_AT_IMAGE_END, { anchor: imageEnd, focus: imageEnd }];

	test('a selected image shows no caret, the browser’s or the editor’s', async ({ page }) => {
		skipUnlessSupported(page, 'caretScreenshot');
		await editor.loadContent(IMAGE_PARAGRAPH);
		await waitForFirstImageLoaded(page);
		await page.locator('[data-image-widget]').first().click();
		await expect.poll(() => selectedImageCaret(page)).toEqual(onlyTheImageEnd);
		await page.mouse.move(5, 5);
		// A caret blinks about twice a second, so a showing one differs across these shots.
		const paragraph = page.locator('.text-editable-block').first();
		const shots: Buffer[] = [];
		for (let i = 0; i < 5; i++) {
			shots.push(await paragraph.screenshot({ caret: 'initial' }));
			await page.waitForTimeout(230);
		}
		expect(shots.every((shot) => shot.equals(shots[0]))).toBe(true);
	});

	test('moving the mouse off a selected image leaves its caret hidden at its end', async ({
		page
	}) => {
		await editor.loadContent(IMAGE_PARAGRAPH);
		const image = page.locator('[data-image-widget]').first();
		await image.click();
		const box = (await image.boundingBox())!;
		await page.mouse.move(box.x + box.width + 40, box.y + box.height + 40);
		await expect(overlay(page)).toBeVisible();
		await expect.poll(() => selectedImageCaret(page)).toEqual(onlyTheImageEnd);
	});

	const controls = [
		{ name: 'the resize handle', opensCrop: false, selector: '.md-resize-handle' },
		{ name: 'the crop frame', opensCrop: true, selector: '.md-image-crop-surface' }
	];
	for (const { name, opensCrop, selector } of controls) {
		test(`a press on ${name} of a selected image leaves its caret hidden at its end`, async ({
			page
		}) => {
			await editor.loadContent(IMAGE_PARAGRAPH);
			await waitForFirstImageLoaded(page);
			const image = page.locator('[data-image-widget]').first();
			if (opensCrop) await multiClickElement(image, 2);
			else await image.click();
			await page.locator(selector).click();
			await expect(overlay(page)).toBeVisible();
			await expect.poll(() => selectedImageCaret(page)).toEqual(onlyTheImageEnd);
		});
	}

	test('End while an image is selected deselects it and moves to the line end', async ({
		page
	}) => {
		await editor.loadContent(IMAGE_PARAGRAPH);
		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
		await page.keyboard.press(edgeKey('lineEnd'));
		await expect(overlay(page)).toHaveCount(0);
		await editor.typeText('W');
		expect(await editor.bridge.getSource()).toBe(
			'before ![pic|120x80](/test-fixtures/sample.png) afterW\n'
		);
	});

	test('Escape deselects', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(overlay(page)).toHaveCount(0);
	});
});
