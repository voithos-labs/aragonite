import type { Page } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { documentCaret, openImageField } from './helpers';

// Undo and redo around a selected image: while it is selected no block holds a caret, so the
// caret an entry records comes from the one the user had before the image took the selection.
test.describe('image selection and history', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const overlay = (page: Page) => page.locator('[data-image-overlay]');
	const IMAGE = '![c|60x40](/test-fixtures/sample.png)';
	const TYPED_BEFORE_IMAGE = `abc ${IMAGE} tail\n`;

	// The caret the editor reports, polled until it is live at `offset` of the first block.
	async function expectLiveCaret(page: Page, offset: number): Promise<void> {
		const point = { path: [0], offset };
		await expect.poll(() => documentCaret(page)).toEqual([1, { anchor: point, focus: point }]);
	}

	// Typing before the image and then selecting it leaves the image at bytes the undo moves.
	async function typeThenSelectImage(page: Page): Promise<void> {
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
		await expectLiveCaret(page, 3);
		// An arrow needs a live caret to move; typing alone lands at the block's remembered offset.
		await page.keyboard.press('ArrowLeft');
		await editor.typeText('W');
		expect(await editor.bridge.getSource()).toBe(`abWc ${IMAGE} tail\n`);
	});

	test('redo after that undo puts the caret back at the image end, live', async ({ page }) => {
		await typeThenSelectImage(page);
		await editor.undo();
		await editor.bridge.waitForSourceContains('abc ![c');
		await editor.redo();
		await editor.bridge.waitForSourceContains('abcxyz');
		await expect(overlay(page)).toHaveCount(0);
		// The redo entry was recorded while the image held the selection: its end, where the click put it.
		const imageEnd = 'abcxyz '.length + IMAGE.length;
		await expectLiveCaret(page, imageEnd);
		// A stale selection drops the redone caret a moment after it lands, not at once.
		await page.waitForTimeout(150);
		await page.keyboard.press('ArrowRight');
		await editor.typeText('W');
		expect(await editor.bridge.getSource()).toBe(`abcxyz ${IMAGE} Wtail\n`);
	});

	test('redo pressed while an image is selected, then undo, lands at the image end', async ({
		page
	}) => {
		await editor.loadContent(TYPED_BEFORE_IMAGE);
		await editor.focusBlock(0, 3);
		await editor.typeSlowly('xyz');
		await editor.waitForUndoBatchFlush();
		await editor.undo();
		await editor.bridge.waitForSourceContains('abc ![c');
		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
		await editor.redo();
		await editor.bridge.waitForSourceContains('abcxyz');
		await editor.undo();
		await editor.bridge.waitForSourceContains('abc ![c');
		await expectLiveCaret(page, 'abc '.length + IMAGE.length);
		await page.waitForTimeout(150);
		await page.keyboard.press('ArrowRight');
		await editor.typeText('W');
		expect(await editor.bridge.getSource()).toBe(`abc ${IMAGE} Wtail\n`);
	});

	test('undo of a removal puts the caret back where the image ended', async ({ page }) => {
		await editor.loadContent(`${TYPED_BEFORE_IMAGE}\nsecond\n`);
		await page.locator('[data-image-widget]').first().click();
		await page
			.locator('.md-image-properties')
			.getByRole('button', { name: 'Remove image' })
			.click();
		await editor.bridge.waitForSourceContains('abc  tail');
		await page.locator('.paragraph-block').nth(1).click();
		await editor.undo();
		await editor.bridge.waitForSourceContains('|60x40');
		await expectLiveCaret(page, 'abc '.length + IMAGE.length);
	});

	test('undo of an alt edit a click elsewhere committed puts the caret back at the image', async ({
		page
	}) => {
		await editor.loadContent(`${TYPED_BEFORE_IMAGE}\nsecond\n`);
		await page.locator('[data-image-widget]').first().click();
		const alt = await openImageField(page);
		await alt.fill('cat');
		await page.locator('.paragraph-block').nth(1).click();
		await editor.bridge.waitForSourceContains('![cat|60x40]');
		await editor.undo();
		await editor.bridge.waitForSourceContains('![c|60x40]');
		await expectLiveCaret(page, 'abc '.length + IMAGE.length);
	});

	test('undo of a resize puts the caret back at the image the user resized', async ({ page }) => {
		await editor.loadContent(`${TYPED_BEFORE_IMAGE}\nsecond\n`);
		await page.locator('[data-image-widget]').first().click();
		const handle = (await page.locator('.md-resize-handle-right').first().boundingBox())!;
		await page.mouse.move(handle.x + 4, handle.y + 4);
		await page.mouse.down();
		await page.mouse.move(handle.x - 16, handle.y + 4, { steps: 5 });
		await page.mouse.up();
		await editor.bridge.waitForSourceNotContains('|60x40');
		// A click in the next paragraph deselects the image, so the undo's caret can be live.
		await page.locator('.paragraph-block').nth(1).click();
		await expect(overlay(page)).toHaveCount(0);
		await editor.undo();
		await editor.bridge.waitForSourceContains('|60x40');
		await expectLiveCaret(page, 'abc '.length + IMAGE.length);
	});
});
