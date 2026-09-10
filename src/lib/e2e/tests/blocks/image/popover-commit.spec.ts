import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { openImageField, undoDepth, waitForAllImagesLoaded } from './helpers';

test.describe('image popover commit', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('popover appears on selection', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await expect(page.locator('.md-image-properties')).toBeVisible();
	});

	test('popover disappears on deselect', async ({ page }) => {
		await editor.loadContent('text\n\n![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		await expect(page.locator('.md-image-properties')).toBeVisible();
		await page.locator('.paragraph-block').first().click();
		await expect(page.locator('.md-image-properties')).not.toBeVisible();
	});

	test('alt edit commits into source on blur', async ({ page }) => {
		// Lead with a non-image paragraph so the click-outside target is genuinely outside the
		// widget: clicking the image's own paragraph lands on the widget and (correctly) keeps the
		// popover open.
		await editor.loadContent('outside paragraph.\n\n![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const altInput = await openImageField(page);
		await altInput.fill('cat v2');
		await page.locator('.paragraph-block').first().click();
		await editor.bridge.waitForSourceContains('![cat v2](/test-fixtures/sample.png)');
	});

	test('popover commits an alt change for an image inside a list item', async ({ page }) => {
		await editor.loadContent('outside paragraph.\n\n- ![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const altInput = await openImageField(page);
		await altInput.fill('nested cat');
		await page.locator('.paragraph-block').first().click();
		await editor.bridge.waitForSourceContains('- ![nested cat](/test-fixtures/sample.png)');
	});

	// The URL has no field: retargeting an image is a source-mode edit.
	test('the toolbar offers no URL field', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		await page.locator('[data-image-widget]').first().click();
		const toolbar = page.locator('.md-image-properties');
		await expect(toolbar.getByRole('button')).toHaveCount(3);
		await expect(toolbar.getByRole('button', { name: 'Image URL' })).toHaveCount(0);
	});

	// The stale-draft class: an open surface holds a copy of bytes the document can move past,
	// and its dismiss commit would put them back over the change.
	test('an undo taken while the popover is open re-seeds it, so the dismiss commits nothing stale', async ({
		page
	}) => {
		await editor.loadContent('outside paragraph.\n\n![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();

		await widget.click();
		let altInput = await openImageField(page);
		await altInput.fill('cat v1');
		await page.locator('.paragraph-block').first().click();
		await editor.bridge.waitForSourceContains('![cat v1]');

		await widget.click();
		altInput = await openImageField(page);
		await expect(altInput).toHaveValue('cat v1');
		// Escape closes the field without a commit, so the undo chord reaches the editor rather
		// than the input's own history.
		await page.keyboard.press('Escape');
		await editor.undo();
		await editor.bridge.waitForSourceNotContains('cat v1');
		altInput = await openImageField(page);
		await expect(altInput).toHaveValue('cat');
		await page.keyboard.press('Escape');

		await page.locator('.paragraph-block').first().click();
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).not.toContain('cat v1');
	});

	// The popover was reused across selection changes, so image 1's local state (`url`, `alt`,
	// closure-captured `initialBytes`) committed against image 2 and overwrote its source bytes.
	test('popover commit targets the image it opened on, not the live selection', async ({
		page
	}) => {
		await editor.loadContent(
			'![alt1|400](/test-fixtures/sample.png) ![alt2|600](/test-fixtures/sample.png)\n\nbelow.\n'
		);
		await waitForAllImagesLoaded(page);
		const widgets = page.locator('[data-image-widget]');
		const w1Box = await widgets.nth(0).boundingBox();
		const w2Box = await widgets.nth(1).boundingBox();
		if (!w1Box || !w2Box) throw new Error('widget boxes missing');
		await page.mouse.click(w1Box.x + w1Box.width / 2, w1Box.y + w1Box.height / 2);
		await (await openImageField(page)).fill('EDITED');
		// Switch to image 2 — old popover unmounts and commits to image 1.
		await page.mouse.click(w2Box.x + w2Box.width / 2, w2Box.y + w2Box.height / 2);
		await page.locator('[contenteditable="true"]').last().click();
		await editor.bridge.waitForSourceContains('EDITED');
		const src = await editor.bridge.getSource();
		expect(src).toContain('![EDITED|400](/test-fixtures/sample.png)');
		expect(src).toContain('![alt2|600](/test-fixtures/sample.png)');
	});

	test('rapid switching between two image popovers without typing leaves both untouched', async ({
		page
	}) => {
		await editor.loadContent(
			'![alt1|400](/test-fixtures/sample.png) ![alt2|600](/test-fixtures/sample.png)\n\nbelow.\n'
		);
		await waitForAllImagesLoaded(page);
		const widgets = page.locator('[data-image-widget]');
		const w1Box = await widgets.nth(0).boundingBox();
		const w2Box = await widgets.nth(1).boundingBox();
		if (!w1Box || !w2Box) throw new Error('widget boxes missing');
		const initialSrc = await editor.bridge.getSource();
		for (let i = 0; i < 20; i++) {
			const target = i % 2 === 0 ? w1Box : w2Box;
			await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
		}
		await page.locator('[contenteditable="true"]').last().click();
		expect(await editor.bridge.getSource()).toBe(initialSrc);
	});

	test('the alt field commits into the hint-free alt on Enter', async ({ page }) => {
		await editor.loadContent('outside paragraph.\n\n![|300](/test-fixtures/sample.png)\n');
		await page.locator('[data-image-widget]').first().click();
		const altInput = await openImageField(page, 'Alt text');
		await expect(altInput).toHaveAttribute('placeholder', 'Describe the image');
		await altInput.fill('a cat');
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('![a cat|300](/test-fixtures/sample.png)');
		// Enter closes the field; the toolbar stays.
		await expect(page.locator('.md-image-properties input')).toHaveCount(0);
		await expect(page.locator('.md-image-properties')).toBeVisible();
	});

	test('the remove button deletes the image span', async ({ page }) => {
		await editor.loadContent('before ![cat](/test-fixtures/sample.png) after\n');
		await page.locator('[data-image-widget]').first().click();
		await page
			.locator('.md-image-properties')
			.getByRole('button', { name: 'Remove image' })
			.click();
		await editor.bridge.waitForSourceEquals('before  after\n');
		await expect(page.locator('[data-image-widget]')).toHaveCount(0);
	});

	test('no-op blur does not add undo entry', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await widget.click();
		const undoLengthBefore = await undoDepth(page);
		await page.locator('.paragraph-block').first().click();
		expect(await undoDepth(page)).toBe(undoLengthBefore);
	});
});
