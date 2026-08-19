import { type Page } from '@playwright/test';

// Shared image-widget probes for the image block e2e specs.

// Resolve once the first widget's <img> has decoded: a point computed from the 0x0 placeholder box
// lands INSIDE the widget once it decodes, selecting the image instead of placing a caret near it.
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

// Undo-stack depth, 0 before the probe installs — the oracle for "that gesture added no entry".
export async function undoDepth(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__test?.dumpUndoStack?.()?.length ?? 0);
}

// Clamped inside the paragraph box: the wrap-boundary position where Chromium parks the caret at
// the image's end offset.
export async function clickPastImageRightEdge(page: Page): Promise<void> {
	const widget = page.locator('[data-image-widget]').first();
	const para = widget.locator('xpath=ancestor::*[@contenteditable="true"]');
	const widgetBox = await widget.boundingBox();
	const paraBox = await para.boundingBox();
	if (!widgetBox || !paraBox) throw new Error('layout boxes missing');
	const clickX = Math.min(widgetBox.x + widgetBox.width + 80, paraBox.x + paraBox.width - 20);
	await page.mouse.click(clickX, widgetBox.y + widgetBox.height / 2);
}
