import { type Locator, type Page } from '@playwright/test';

// Shared image-widget reads for the image block e2e specs.

// Resolve once the first widget's `<img>` has decoded: a point worked out from the 0x0 placeholder
// box lands inside the widget afterwards, selecting the image instead of placing a caret near it.
export async function waitForFirstImageLoaded(page: Page): Promise<void> {
	await page.waitForFunction(
		() => !!(document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
	);
}

// Every widget decoded: a spec staging one image's reflow against another needs both settled first.
export async function waitForAllImagesLoaded(page: Page): Promise<void> {
	await page.waitForFunction(() =>
		Array.from(document.querySelectorAll('[data-image-widget] img')).every(
			(img) => (img as HTMLImageElement).complete
		)
	);
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

/** A point in the strip between the first picture's edge and the edge of the paragraph box
 *  around it: inside the block, off the picture's own line. `xFraction` picks the column across
 *  the picture, so a caller can aim either side of its middle. */
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
		() =>
			new Promise<void>((resolve) => {
				const sel = window.getSelection();
				if (!sel || sel.rangeCount === 0) return resolve();
				document.addEventListener('selectionchange', () => resolve(), { once: true });
				sel.removeAllRanges();
			})
	);
	await page.evaluate(() =>
		(window as unknown as { __test: { drainTick(): Promise<void> } }).__test.drainTick()
	);
}

/** The toolbar's one field, the alt: press its button, then the input is the one there. */
export async function openImageField(page: Page, name: 'Alt text' = 'Alt text'): Promise<Locator> {
	await page.locator('.md-image-properties').getByRole('button', { name, exact: true }).click();
	const input = page.locator('.md-image-properties input');
	await input.waitFor({ state: 'visible' });
	return input;
}
