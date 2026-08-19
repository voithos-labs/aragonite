import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { undoDepth } from './helpers';

// An image nested inside a link (`[![alt][ref]][repo]`) is click-selectable and keyboard-resizable
// only where the paths walk past top-level inlines, and a reference-style image keeps its `[ref]:`
// LRD through a resize or edit — only an explicit url/title change may inline it.
test.describe('image inside a link + reference-style images', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const overlay = (page: import('@playwright/test').Page) => page.locator('[data-image-overlay]');

	// `[shot]` resolves the inner image; `[repo]` resolves the outer link — both
	// must resolve for the nested link→image structure to form.
	const NESTED = [
		'[![cat][shot]][repo]',
		'',
		'[shot]: /test-fixtures/sample.png',
		'[repo]: https://example.com',
		''
	].join('\n');

	const NESTED_SIZED = [
		'[![cat|300][shot]][repo]',
		'',
		'[shot]: /test-fixtures/sample.png',
		'[repo]: https://example.com',
		''
	].join('\n');

	const REFERENCE = ['![cat|400][ref]', '', '[ref]: /test-fixtures/sample.png', ''].join('\n');

	// Fail-fast guard: without the harness's LRD resolver these render as plain text and every
	// assertion below would mis-report as "click selects nothing".
	test('a reference image nested in a link renders as a widget', async ({ page }) => {
		await editor.loadContent(NESTED);
		await expect(page.locator('[data-image-widget]').first()).toBeVisible();
	});

	test('clicking an image inside a link enters selected state', async ({ page }) => {
		await editor.loadContent(NESTED);
		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
	});

	test('resizing an image inside a link keeps the link wrapper and reference', async ({ page }) => {
		await editor.loadContent(NESTED_SIZED);
		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
		await page.keyboard.press('Shift+ArrowRight');
		await editor.bridge.waitForSourceContains('[![cat|320][shot]][repo]');
		const src = await editor.bridge.getSource();
		expect(src).toContain('[![cat|320][shot]][repo]');
		expect(src).toContain('[shot]: /test-fixtures/sample.png');
		expect(src).not.toContain('![cat|320](');
	});

	test('resizing a standalone reference image stays a reference and keeps the LRD', async ({
		page
	}) => {
		await editor.loadContent(REFERENCE);
		await page.locator('[data-image-widget]').first().click();
		await expect(overlay(page)).toBeVisible();
		await page.keyboard.press('Shift+ArrowRight');
		await editor.bridge.waitForSourceContains('![cat|420][ref]');
		const src = await editor.bridge.getSource();
		expect(src).toContain('![cat|420][ref]');
		expect(src).toContain('[ref]: /test-fixtures/sample.png');
		// Not inlined — the resolved url is never written into the image span.
		expect(src).not.toContain('![cat|420](');
	});

	test('changing the url in the popover inlines a reference image (intended)', async ({ page }) => {
		// Lead with a non-image paragraph so the dismiss click lands outside the widget.
		await editor.loadContent(
			['outside.', '', '![cat|400][ref]', '', '[ref]: /test-fixtures/sample.png', ''].join('\n')
		);
		await page.locator('[data-image-widget]').first().click();
		await expect(page.locator('.md-image-properties')).toBeVisible();
		await page.locator('.md-image-properties input').first().fill('/test-fixtures/sample.png?v=2');
		await page.locator('.paragraph-block').first().click();
		await editor.bridge.waitForSourceContains('?v=2');
		const src = await editor.bridge.getSource();
		expect(src).toContain('![cat|400](/test-fixtures/sample.png?v=2)');
		expect(src).not.toContain('![cat|400][ref]');
	});

	test('a no-op popover dismiss preserves the reference and adds no undo entry', async ({
		page
	}) => {
		await editor.loadContent(
			['outside.', '', '![cat|400][ref]', '', '[ref]: /test-fixtures/sample.png', ''].join('\n')
		);
		await page.locator('[data-image-widget]').first().click();
		await expect(page.locator('.md-image-properties')).toBeVisible();
		const undoBefore = await undoDepth(page);
		await page.locator('.paragraph-block').first().click();
		await editor.waitForNoSourceMutation();
		expect(await undoDepth(page)).toBe(undoBefore);
		const src = await editor.bridge.getSource();
		expect(src).toContain('![cat|400][ref]');
		expect(src).toContain('[ref]: /test-fixtures/sample.png');
	});
});
