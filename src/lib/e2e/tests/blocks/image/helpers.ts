import { type Locator, type Page } from '@playwright/test';
import { isWebKit } from '../../../browser-engine';
import { clickInPlace } from '../../../click-in-place';
import { expect } from '../../../fixtures';

// Shared image-widget reads for the image block e2e specs.

const WIDGET_IMAGE = '[data-image-widget] img';

/** At least one `<img>` matches `images` and each has decoded, or the spec fails naming it;
 *  `complete` and `naturalWidth` also pass for a picture whose pixels never decode. */
export async function waitForImagesDecoded(images: Locator): Promise<void> {
	await images.first().waitFor({ state: 'attached' });
	const undecodable = await images.evaluateAll((imgs) =>
		Promise.all(
			(imgs as HTMLImageElement[]).map((img) =>
				img.decode().then(
					() => null,
					(e: Error) => `${img.currentSrc || img.src}: ${e.name}`
				)
			)
		).then((outcomes) => outcomes.filter((outcome) => outcome !== null))
	);
	expect(undecodable, 'every image decoded').toEqual([]);
}

// The first widget's picture: a point worked out from the 0x0 placeholder box lands inside the
// widget afterwards, and a crop starts only over a decoded picture.
export function waitForFirstImageLoaded(page: Page): Promise<void> {
	return waitForImagesDecoded(page.locator(WIDGET_IMAGE).first());
}

// Every widget's picture, none at all included: a spec staging one image's reflow against another
// needs both decoded, and a row table can run the same wait over a shape with no picture.
export async function waitForAllImagesLoaded(page: Page): Promise<void> {
	const images = page.locator(WIDGET_IMAGE);
	if ((await images.count()) > 0) await waitForImagesDecoded(images);
}

/** The document caret: the native range count and the editor's own read of the selection. */
export async function documentCaret(page: Page): Promise<[number, unknown]> {
	return page.evaluate(() => [
		window.getSelection()?.rangeCount ?? 0,
		(window as any).__test.getSelection()
	]);
}

/** What the browser's selection is beside a selected image, as `selectedImageCaret` names it. */
export const HIDDEN_AT_IMAGE_END = 'a hidden caret at the image’s end';

/** The browser's selection by name, and the editor's own read of the selection. A caret is
 *  hidden when its editable's `caret-color` is transparent and no bar draws. */
export async function selectedImageCaret(page: Page): Promise<[string, unknown]> {
	return page.evaluate(() => {
		const sel = window.getSelection();
		const read = (window as any).__test.getSelection();
		const node = sel && sel.rangeCount > 0 ? sel.focusNode : null;
		if (!sel || !node) return ['none', read];
		if (!sel.isCollapsed) return ['a range', read];
		const image = document.querySelector('[data-image-widget]');
		const past = document.createRange();
		if (image) past.setStartAfter(image);
		const atEnd = !!image && past.comparePoint(node, sel.focusOffset) >= 0;
		if (atEnd) past.setEnd(node, sel.focusOffset);
		const host = (node instanceof Element ? node : node.parentElement)?.closest(
			'[contenteditable]'
		);
		const bar = document.querySelector<HTMLElement>('.md-drawn-caret');
		const hidden =
			!!host && getComputedStyle(host).caretColor === 'rgba(0, 0, 0, 0)' && (bar?.hidden ?? true);
		const where = atEnd && past.toString() === '' ? 'at the image’s end' : 'elsewhere';
		return [`a ${hidden ? 'hidden' : 'showing'} caret ${where}`, read];
	});
}

// Undo-stack depth, 0 before the hook installs: the read that says a gesture added no entry.
export async function undoDepth(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__test?.dumpUndoStack?.()?.length ?? 0);
}

/** The dead space past the first image's right edge, clamped inside the paragraph box: the
 *  wrap-boundary position where Chromium puts the caret at the image's end offset. */
export async function pointPastImageRightEdge(page: Page): Promise<{ x: number; y: number }> {
	const widget = page.locator('[data-image-widget]').first();
	const para = widget.locator('xpath=ancestor::*[@contenteditable="true"]');
	const widgetBox = await widget.boundingBox();
	const paraBox = await para.boundingBox();
	if (!widgetBox || !paraBox) throw new Error('layout boxes missing');
	const x = Math.min(widgetBox.x + widgetBox.width + 80, paraBox.x + paraBox.width - 20);
	return { x, y: widgetBox.y + widgetBox.height / 2 };
}

export async function clickPastImageRightEdge(page: Page): Promise<void> {
	const point = await pointPastImageRightEdge(page);
	await page.mouse.click(point.x, point.y);
}

/** A point in the strip between the first picture's edge and its paragraph box: inside the block,
 *  off the picture's line. `xFraction` picks the column across the picture. */
export async function pointOffImageLine(
	page: Page,
	side: 'above' | 'below',
	xFraction: number
): Promise<{ x: number; y: number }> {
	const widget = page.locator('[data-image-widget]').first();
	const para = widget.locator('xpath=ancestor::*[@contenteditable="true"]');
	const widgetBox = await widget.boundingBox();
	const paraBox = await para.boundingBox();
	if (!widgetBox || !paraBox) throw new Error('layout boxes missing');
	const top = side === 'above' ? paraBox.y : widgetBox.y + widgetBox.height;
	const bottom = side === 'above' ? widgetBox.y : paraBox.y + paraBox.height;
	if (bottom - top < 4) throw new Error(`the paragraph box leaves no strip ${side} the picture`);
	return { x: widgetBox.x + widgetBox.width * xFraction, y: (top + bottom) / 2 };
}

/** The state Chromium reaches on its own between a click beside an atomic widget and the next
 *  keystroke: the range is gone, and the `selectionchange` it fires has been handled. */
export async function dropNativeCaret(page: Page): Promise<void> {
	await page.evaluate(
		(firesEvent) =>
			new Promise<void>((resolve) => {
				const sel = window.getSelection();
				if (!sel || sel.rangeCount === 0) return resolve();
				// WebKit fires no `selectionchange` for the removal, so there is no handler to wait for.
				if (firesEvent)
					document.addEventListener('selectionchange', () => resolve(), { once: true });
				sel.removeAllRanges();
				if (!firesEvent) resolve();
			}),
		!isWebKit(page)
	);
	await page.evaluate(() =>
		(window as unknown as { __test: { drainTick(): Promise<void> } }).__test.drainTick()
	);
}

/** The toolbar's one field, the alt: click its button, then the input is the one there. */
export async function openImageField(page: Page, name: 'Alt text' = 'Alt text'): Promise<Locator> {
	await clickInPlace(
		page.locator('.md-image-properties').getByRole('button', { name, exact: true })
	);
	const input = page.locator('.md-image-properties input');
	await input.waitFor({ state: 'visible' });
	return input;
}
