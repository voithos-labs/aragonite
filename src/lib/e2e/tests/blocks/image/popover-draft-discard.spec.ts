import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { openImageField, waitForAllImagesLoaded } from './helpers';

// An unsaved alt draft belongs to the image the popover opened on; when the document moves that
// image away, the draft is dropped rather than written over whatever now sits in its place
// (requirements/blocks/image/popover-draft-discard.md). The shared fixture fails on page errors.

const IMAGE = '/test-fixtures/sample.png';

test.describe('image popover draft discard', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('a source swap under an open alt draft leaves the new document alone', async ({ page }) => {
		await editor.loadContent(`![one](${IMAGE})\n\nbelow.\n`);
		await waitForAllImagesLoaded(page);
		await page.locator('[data-image-widget]').first().click();
		await (await openImageField(page)).fill('draft');

		const incoming = `![two](${IMAGE})\n\nbelow.\n`;
		await page.evaluate((md) => (window as any).__test.setSource(md), incoming);
		await expect(page.locator('.md-image-properties')).toHaveCount(0);
		await page.locator('.paragraph-block').last().click();

		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(incoming);
	});

	test('an undo that takes the image away under an open alt draft discards the draft', async ({
		page
	}) => {
		await editor.loadContent(`![two](${IMAGE})\n`);
		await editor.focusBlockStart(0);
		await page.evaluate((md) => (window as any).__test.insertMarkdown(md), `![one](${IMAGE})\n\n`);
		await editor.bridge.waitForSourceEquals(`![one](${IMAGE})\n\n![two](${IMAGE})\n`);
		await waitForAllImagesLoaded(page);
		await page.locator('[data-image-widget]').first().click();
		await (await openImageField(page)).fill('draft');

		await page.evaluate(() => (window as any).__test.runCommand('history.undo'));
		await editor.bridge.waitForSourceEquals(`![two](${IMAGE})\n`);
		await page.locator('.paragraph-block').last().click();

		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(`![two](${IMAGE})\n`);
	});
});
