import type { Page } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import {
	clickPastImageRightEdge,
	pointPastImageRightEdge,
	waitForAllImagesLoaded,
	waitForFirstImageLoaded
} from './helpers';

const LIST_IMAGE_DOC = '- ![pic|300x200](/test-fixtures/sample.png)\n';
// Two islands in two blocks, each ending its own line, with a plain block to park in between.
const TWO_IMAGE_DOC =
	'![a|120x80](/test-fixtures/sample.png)\n\n![b|120x80](/test-fixtures/sample.png)\n\nplain text\n';

const paintedCarets = (page: Page): Promise<string[]> =>
	page.evaluate(() =>
		Array.from(document.querySelectorAll('.md-snap-after, .md-snap-before')).map(
			(el) => el.closest('[data-block-path]')?.getAttribute('data-block-path') ?? '?'
		)
	);

/** The dead space past the nth image, inside its own paragraph: the press that snaps there. */
async function clickPastImage(page: Page, index: number): Promise<void> {
	const widget = page.locator('[data-image-widget]').nth(index);
	const para = widget.locator('xpath=ancestor::*[@contenteditable="true"]');
	const widgetBox = await widget.boundingBox();
	const paraBox = await para.boundingBox();
	if (!widgetBox || !paraBox) throw new Error('layout boxes missing');
	const x = Math.min(widgetBox.x + widgetBox.width + 60, paraBox.x + paraBox.width - 20);
	await page.mouse.click(x, widgetBox.y + widgetBox.height / 2);
}

const caretColorOfFocusedBlock = (page: Page): Promise<string> =>
	page.evaluate(() => {
		const block = document.querySelector('[data-image-widget]')?.closest('[contenteditable]');
		if (!block) throw new Error('no contenteditable holding the widget');
		return getComputedStyle(block).caretColor;
	});

// The synthetic indicator is the fallback for "native caret can't render": it appears only at a
// widget boundary AT ELEMENT-LEVEL (no text-node anchor) or when Chromium dropped the caret. Where
// the native caret renders it stays absent, so the two never compete.
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

	test('the native caret goes dark while the synthetic one is painted', async ({ page }) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);
		await clickPastImageRightEdge(page);
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(1);

		// The other half of "the two indicators don't compete": at an element-level offset the
		// editor can't see whether Chromium painted a native caret, so suppressing it is the only
		// mutual exclusion left.
		expect(await caretColorOfFocusedBlock(page)).toBe('rgba(0, 0, 0, 0)');
	});

	// The press seats the browser's caret before the click arms the synthetic one, and at the
	// element-level offset beside the island Chromium paints it at the line box's height: a taller
	// stroke for the length of the press, then the synthetic. So the dark starts at the press.
	test('the native caret is dark from the press, before the click arms the synthetic', async ({
		page
	}) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);
		const point = await pointPastImageRightEdge(page);
		await page.mouse.move(point.x, point.y);
		await page.mouse.down();

		await expect.poll(() => caretColorOfFocusedBlock(page)).toBe('rgba(0, 0, 0, 0)');
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(0);

		await page.mouse.up();
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(1);
		expect(await caretColorOfFocusedBlock(page)).toBe('rgba(0, 0, 0, 0)');
	});

	test('a press that seats in text keeps the native caret', async ({ page }) => {
		await editor.loadContent('- ![pic|300x200](/test-fixtures/sample.png) trailing words\n');
		await waitForFirstImageLoaded(page);
		const para = page
			.locator('[data-image-widget]')
			.locator('xpath=ancestor::*[@contenteditable="true"]');
		const box = (await para.boundingBox())!;
		await page.mouse.move(box.x + box.width - 30, box.y + box.height - 12);
		await page.mouse.down();
		await expect.poll(() => caretColorOfFocusedBlock(page)).not.toBe('rgba(0, 0, 0, 0)');
		await page.mouse.up();
		expect(await caretColorOfFocusedBlock(page)).not.toBe('rgba(0, 0, 0, 0)');
	});

	// One caret is one position. The block that armed a synthetic caret clears it on the next
	// selection change, but a state it never hears about — a selection cleared out from under it,
	// its own block unmounted while the caret was inside — would leave a second caret on screen.
	test('a second block arming its own caret takes the paint from the first', async ({ page }) => {
		await editor.loadContent(TWO_IMAGE_DOC);
		await waitForAllImagesLoaded(page);

		await clickPastImage(page, 0);
		await expect.poll(() => paintedCarets(page)).toEqual(['[0]']);

		await clickPastImage(page, 1);
		await expect.poll(() => paintedCarets(page)).toEqual(['[1]']);
	});

	test('a stale caret left on another block is swept when one arms', async ({ page }) => {
		await editor.loadContent(TWO_IMAGE_DOC);
		await waitForAllImagesLoaded(page);
		await clickPastImage(page, 1);
		await expect.poll(() => paintedCarets(page)).toEqual(['[1]']);

		// The state no block can clear for itself, painted by hand: the class a block left behind.
		await page.evaluate(() =>
			document.querySelectorAll('[data-image-widget]')[0].classList.add('md-snap-after')
		);
		expect(await paintedCarets(page)).toEqual(['[0]', '[1]']);

		await editor.clickBlock(2);
		await clickPastImage(page, 1);

		await expect.poll(() => paintedCarets(page)).toEqual(['[1]']);
	});

	test('the native caret comes back when the synthetic clears', async ({ page }) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);
		await clickPastImageRightEdge(page);
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(1);

		await page.keyboard.press('a');
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(0);
		// Non-vacuity: the suppression is scoped to the snap, not a permanent state.
		expect(await caretColorOfFocusedBlock(page)).not.toBe('rgba(0, 0, 0, 0)');
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
		// Either snap class or a live caret in trailing text is a valid post-click state.
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('[data-inline-widget].md-snap-after')).toHaveCount(0);
		await expect(page.locator('[data-inline-widget].md-snap-before')).toHaveCount(0);
	});
});
