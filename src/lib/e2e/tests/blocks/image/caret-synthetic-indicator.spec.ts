import type { Page } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import {
	clickPastImageRightEdge,
	dropNativeCaret,
	pointPastImageRightEdge,
	waitForAllImagesLoaded,
	waitForFirstImageLoaded
} from './helpers';
import { caretsShowing, drawnCaretBox } from '../../../carets-showing';

const ONE_DRAWN = { native: false, drawn: 1 };

const LIST_IMAGE_DOC = '- ![pic|300x200](/test-fixtures/sample.png)\n';
// Two image widgets in two blocks, each ending its own line, with a plain block between them.
const TWO_IMAGE_DOC =
	'![a|120x80](/test-fixtures/sample.png)\n\n![b|120x80](/test-fixtures/sample.png)\n\nplain text\n';

const paintedCarets = (page: Page): Promise<string[]> =>
	page.evaluate(() =>
		Array.from(document.querySelectorAll('.md-snap-after, .md-snap-before')).map(
			(el) => el.closest('[data-block-path]')?.getAttribute('data-block-path') ?? '?'
		)
	);

/** The dead space past the nth image, inside its own paragraph: the click that snaps there. */
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

// The editor draws its own caret marker only where the browser cannot: at a widget boundary with no
// text node, or after Chromium dropped the caret, so one caret means one position (G1.39).
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
		// Width is set to 1.5px and Chromium reports it rounded, so accept any thin line.
		expect(parseFloat(overlay!.width)).toBeLessThan(4);
	});

	// The click arms a nested widget's edge, so the paint has to find the same widget.
	for (const [wrapper, doc] of [
		['a link', '[![pic|300x200](/test-fixtures/sample.png)](https://x)\n'],
		['emphasis', '*![pic|300x200](/test-fixtures/sample.png)*\n']
	]) {
		test(`live mode: a click past an image inside ${wrapper} paints the synthetic caret`, async ({
			page
		}) => {
			await editor.loadContent(doc);
			await editor.setPresentationMode('live');
			await waitForFirstImageLoaded(page);
			await clickPastImageRightEdge(page);

			await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(1);
			expect(await caretColorOfFocusedBlock(page)).toBe('rgba(0, 0, 0, 0)');
		});
	}

	// Beside an image widget Chromium paints a taller native caret while the button is down, so the
	// caret is hidden from pointerdown on.
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

	test('a press that puts the caret in text shows one caret, the drawn one', async ({ page }) => {
		await editor.loadContent('- ![pic|300x200](/test-fixtures/sample.png) trailing words\n');
		await waitForFirstImageLoaded(page);
		const para = page
			.locator('[data-image-widget]')
			.locator('xpath=ancestor::*[@contenteditable="true"]');
		const box = (await para.boundingBox())!;
		await page.mouse.move(box.x + box.width - 30, box.y + box.height - 12);
		await page.mouse.down();
		await expect.poll(() => caretsShowing(page)).toEqual(ONE_DRAWN);
		await page.mouse.up();
		await expect.poll(() => caretsShowing(page)).toEqual(ONE_DRAWN);
	});

	// One caret is one position. A block clears its own caret marker on the next selection change,
	// but a block that unmounts with the caret inside never hears that change.
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

		// The leftover class a block cannot clear for itself, put on the widget by hand.
		await page.evaluate(() =>
			document.querySelectorAll('[data-image-widget]')[0].classList.add('md-snap-after')
		);
		expect(await paintedCarets(page)).toEqual(['[0]', '[1]']);

		await editor.clickBlock(2);
		await clickPastImage(page, 1);

		await expect.poll(() => paintedCarets(page)).toEqual(['[1]']);
	});

	test('the drawn caret comes back when the synthetic clears', async ({ page }) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);
		await clickPastImageRightEdge(page);
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(1);

		await page.keyboard.press('a');
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(0);
		// Non-vacuity: the caret is hidden only for the snap, not permanently.
		await expect.poll(() => caretsShowing(page)).toEqual(ONE_DRAWN);
		expect(await drawnCaretBox(page)).not.toBeNull();
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

	// The marker stands in for a caret the browser will not draw, so the state where the browser
	// holds no range at all is the one it exists for, not a reason to stop painting.
	test('synthetic caret survives the browser dropping the caret', async ({ page }) => {
		await editor.loadContent(LIST_IMAGE_DOC);
		await waitForFirstImageLoaded(page);
		await clickPastImageRightEdge(page);
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(1);

		await dropNativeCaret(page);
		expect(await paintedCarets(page)).toEqual(['[0,0,0]']);
	});

	// While the editor's own range is up, no block may still paint its caret underneath, even when
	// the range's focus returns to the armed offset and the browser's caret has not moved.
	test('no synthetic caret is painted while a cross-block range is up', async ({ page }) => {
		await editor.loadContent(TWO_IMAGE_DOC);
		await waitForAllImagesLoaded(page);
		await clickPastImage(page, 0);
		await expect.poll(() => paintedCarets(page)).toEqual(['[0]']);
		const armed = (await editor.bridge.getSelection())!.focus;

		expect(
			await editor.bridge.setSelection({ anchor: { path: [2], offset: 0 }, focus: armed })
		).toBe(true);

		await expect.poll(() => editor.bridge.isCrossBlockSelection()).toBe(true);
		await expect.poll(() => paintedCarets(page)).toEqual([]);
	});

	// Pointerdown, which the drag answers before any range exists, kept because it is the gesture a
	// user makes.
	test('synthetic caret clears when a press lands in another block', async ({ page }) => {
		await editor.loadContent(TWO_IMAGE_DOC);
		await waitForAllImagesLoaded(page);
		await clickPastImage(page, 0);
		await expect.poll(() => paintedCarets(page)).toEqual(['[0]']);

		const tail = page.locator('[contenteditable="true"]').last();
		const tb = (await tail.boundingBox())!;
		await page.mouse.move(tb.x + 40, tb.y + tb.height / 2);
		await page.mouse.down();

		await expect.poll(() => paintedCarets(page)).toEqual([]);
		await page.mouse.up();
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
