import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { documentCaret } from './helpers';

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
	// start on the next mouse input of any kind; none may outlive the selected image.
	const IMAGE_PARAGRAPH = 'before ![pic|120x80](/test-fixtures/sample.png) after\n';

	test('moving the mouse off a selected image leaves no document caret', async ({ page }) => {
		await editor.loadContent(IMAGE_PARAGRAPH);
		const image = page.locator('[data-image-widget]').first();
		await image.click();
		const box = (await image.boundingBox())!;
		await page.mouse.move(box.x + box.width + 40, box.y + box.height + 40);
		await expect(overlay(page)).toBeVisible();
		await expect.poll(() => documentCaret(page)).toEqual([0, null]);
	});

	const controls = [
		{ name: 'the resize handle', opensCrop: false, selector: '.md-resize-handle' },
		{ name: 'the crop frame', opensCrop: true, selector: '.md-image-crop-surface' }
	];
	for (const { name, opensCrop, selector } of controls) {
		test(`a press on ${name} of a selected image leaves no document caret`, async ({ page }) => {
			await editor.loadContent(IMAGE_PARAGRAPH);
			const image = page.locator('[data-image-widget]').first();
			if (opensCrop) await image.dblclick();
			else await image.click();
			await page.locator(selector).click();
			await expect(overlay(page)).toBeVisible();
			await expect.poll(() => documentCaret(page)).toEqual([0, null]);
		});
	}

	const TYPED_BEFORE_IMAGE = 'abc ![c|60x40](/test-fixtures/sample.png) tail\n';

	// Typing before the image and then selecting it leaves the image at bytes the undo moves.
	async function typeThenSelectImage(page: import('@playwright/test').Page): Promise<void> {
		await editor.loadContent(TYPED_BEFORE_IMAGE);
		await editor.focusBlock(0, 3);
		await editor.typeSlowly('xyz');
		await editor.waitForUndoBatchFlush();
		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
	}

	test('undo of an edit made before selecting an image deselects it and restores the caret', async ({
		page
	}) => {
		await typeThenSelectImage(page);
		await editor.undo();
		await editor.bridge.waitForSourceContains('abc ![c');
		await expect(overlay(page)).toHaveCount(0);
		await editor.typeText('W');
		expect(await editor.bridge.getSource()).toBe(
			'abcW ![c|60x40](/test-fixtures/sample.png) tail\n'
		);
	});

	test('redo after that undo leaves the redone caret live', async ({ page }) => {
		await typeThenSelectImage(page);
		await editor.undo();
		await editor.bridge.waitForSourceContains('abc ![c');
		await editor.redo();
		await editor.bridge.waitForSourceContains('abcxyz');
		await expect(overlay(page)).toHaveCount(0);
		// The redo entry was recorded while the image held the selection and no caret existed,
		// which it stores as the paragraph's start.
		const start = { path: [0], offset: 0 };
		await expect.poll(() => documentCaret(page)).toEqual([1, { anchor: start, focus: start }]);
	});

	test('End while an image is selected deselects it and moves to the line end', async ({
		page
	}) => {
		await editor.loadContent(IMAGE_PARAGRAPH);
		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
		await page.keyboard.press('End');
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
