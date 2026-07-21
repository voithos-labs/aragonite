import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { clickPastImageRightEdge, waitForFirstImageLoaded } from './helpers';

const LIST_IMAGE_DOC = '- ![pic|300x200](/test-fixtures/sample.png)\n';

// Synthetic indicator is a fallback for "native caret can't render" — it
// appears only when the cursor is at a widget boundary AT ELEMENT-LEVEL
// (no text-node anchor) or when Chromium dropped the caret entirely. In
// any state where native caret renders (cursor in a text node), the
// synthetic stays absent so the two indicators don't compete.
test.describe('synthetic caret indicator at widget boundary', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('snap-target widget shows a synthetic caret on the right edge', async ({ page }) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);
		await clickPastImageRightEdge(page);
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(1);

		const overlay = await page.evaluate(() => {
			const w = document.querySelector('[data-image-widget].md-snap-after') as HTMLElement;
			if (!w) return null;
			const before = window.getComputedStyle(w, '::before');
			return {
				content: before.content,
				position: before.position,
				bg: before.backgroundColor,
				width: before.width
			};
		});
		expect(overlay).not.toBeNull();
		expect(overlay!.content).not.toBe('none');
		expect(overlay!.position).toBe('absolute');
		// width is set to 1.5px; Chromium reports rounded — accept the line being thin.
		expect(parseFloat(overlay!.width)).toBeLessThan(4);
	});

	test('arrow-left into a widget boundary in trailing text does not show synthetic', async ({
		page
	}) => {
		await editor.loadContent('- ![pic|300x200](/test-fixtures/sample.png)a\n');
		await waitForFirstImageLoaded(page);
		await page.evaluate(() => {
			const ce = document.querySelector('[contenteditable="true"]') as HTMLElement;
			ce.focus();
			const w = ce.querySelector('[data-image-widget]') as HTMLElement;
			const trailing = w.nextSibling as Text;
			const range = document.createRange();
			range.setStart(trailing, trailing.textContent!.length);
			range.collapse(true);
			window.getSelection()!.removeAllRanges();
			window.getSelection()!.addRange(range);
		});
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(0);
		await expect(page.locator('[data-image-widget].md-snap-before')).toHaveCount(0);
	});

	test('click that lands cursor in trailing text does not show synthetic', async ({ page }) => {
		await editor.loadContent('- ![pic|300x200](/test-fixtures/sample.png)abcdef\n');
		await waitForFirstImageLoaded(page);
		const widget = page.locator('[data-image-widget]').first();
		const widgetBox = await widget.boundingBox();
		if (!widgetBox) throw new Error();
		await page.mouse.click(widgetBox.x + widgetBox.width + 4, widgetBox.y + widgetBox.height / 2);
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(0);
	});

	test('synthetic appears after Enter splits paragraph and clicking image-only block', async ({
		page
	}) => {
		await editor.loadContent('- ![pic|300x200](/test-fixtures/sample.png)a\n');
		await waitForFirstImageLoaded(page);
		await page.evaluate(() => {
			const ce = document.querySelector('[contenteditable="true"]') as HTMLElement;
			ce.focus();
			const w = ce.querySelector('[data-image-widget]') as HTMLElement;
			const trailing = w.nextSibling as Text;
			const range = document.createRange();
			range.setStart(trailing, 0);
			range.collapse(true);
			window.getSelection()!.removeAllRanges();
			window.getSelection()!.addRange(range);
		});
		await page.keyboard.press('Enter');
		await clickPastImageRightEdge(page);
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(1);
	});

	test('synthetic caret clears after the first typed character', async ({ page }) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);
		await clickPastImageRightEdge(page);
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(1);
		await page.keyboard.press('a');
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(0);
	});

	test('synthetic caret clears when clicking into a different paragraph', async ({ page }) => {
		await editor.loadContent(
			'- ![pic|300x200](/test-fixtures/sample.png)\n\nfollowing paragraph.\n'
		);
		await waitForFirstImageLoaded(page);
		await clickPastImageRightEdge(page);
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(1);

		const followingPara = page.locator('[contenteditable="true"]').nth(1);
		await followingPara.click();
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(0);
	});

	test('synthetic caret clears when arrow keys move the caret away', async ({ page }) => {
		await editor.loadContent('lead text ![pic|240x180](/test-fixtures/sample.png) trail text\n');
		await waitForFirstImageLoaded(page);
		const widget = page.locator('[data-image-widget]').first();
		const widgetBox = await widget.boundingBox();
		if (!widgetBox) throw new Error();
		await page.mouse.click(widgetBox.x + widgetBox.width + 1, widgetBox.y + widgetBox.height / 2);
		// Either snap class or live caret in trailing text — both are valid
		// post-click states. Move caret with arrow key and assert no
		// snap-class persists afterwards.
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('[data-inline-widget].md-snap-after')).toHaveCount(0);
		await expect(page.locator('[data-inline-widget].md-snap-before')).toHaveCount(0);
	});
});
