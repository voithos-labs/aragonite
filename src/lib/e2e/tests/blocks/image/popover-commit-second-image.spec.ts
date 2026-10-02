import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { documentCaret, openImageField, waitForAllImagesLoaded } from './helpers';

// Moving from one image's unsaved edit to a second image in the same paragraph: the first
// image's edit lands as the popover closes, which moves the second image's bytes.
test.describe('image popover commit, then a second image', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const FIRST = '![alt1|400](/test-fixtures/sample.png)';
	const SECOND = '![alt2|600](/test-fixtures/sample.png)';
	const EDITED = '![alt one edited|400](/test-fixtures/sample.png)';

	test('a click on the second image selects it on the first click', async ({ page }) => {
		await editor.loadContent(`${FIRST} ${SECOND} tail\n`);
		await waitForAllImagesLoaded(page);
		await page.locator('[data-image-widget]').first().click();
		const alt = await openImageField(page);
		await alt.fill('alt one edited');
		await page.locator('[data-image-widget]').nth(1).click();
		await editor.bridge.waitForSourceContains(EDITED);
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		// The toolbar that shows is the second image's: its field reads that image's alt.
		await expect(await openImageField(page)).toHaveValue('alt2');
	});

	test('undo of the first edit puts the caret back at the first image', async ({ page }) => {
		await editor.loadContent(`${FIRST} ${SECOND} tail\n`);
		await waitForAllImagesLoaded(page);
		await page.locator('[data-image-widget]').first().click();
		const alt = await openImageField(page);
		await alt.fill('alt one edited');
		await page.locator('[data-image-widget]').nth(1).click();
		await editor.bridge.waitForSourceContains(EDITED);
		await editor.undo();
		await editor.bridge.waitForSourceContains(FIRST);
		// Where the click that selected the first image put the caret: that image's end.
		const firstEnd = { path: [0], offset: FIRST.length };
		await expect
			.poll(() => documentCaret(page))
			.toEqual([1, { anchor: firstEnd, focus: firstEnd }]);
	});
});
