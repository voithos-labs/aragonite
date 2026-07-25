import { type Page } from '@playwright/test';

// Shared image-widget probes for the image block e2e specs.

// Resolve once the first image widget's <img> has finished decoding, so a
// subsequent geometry read sees the real box, not the 0x0 placeholder. Skipping
// this does not merely blur a coordinate: a point computed from the placeholder
// box lands INSIDE the widget once it decodes, which selects the image instead
// of placing a caret near it.
export async function waitForFirstImageLoaded(page: Page): Promise<void> {
	await page.waitForFunction(
		() => !!(document.querySelector('[data-image-widget] img') as HTMLImageElement)?.complete
	);
}

// Click just past the right edge of the first image widget, clamped inside the
// paragraph box — the wrap-boundary position where Chromium parks the caret at
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
