import { type SimContext, settleTypedSource } from '../invariants';

// Image gestures. Each waits for the image to load and resyncs after the editor rewrites the
// `|N` width.

const IMAGE_WIDGET = '[data-image-widget]';
const RIGHT_HANDLE = '.md-resize-handle-right';

// The same numbers the widget resizes by (components/image/): each Shift+Arrow moves 20px, the
// width never drops below 32, and an image with no width starts from 400.
const KEYBOARD_STEP = 20;
const KEYBOARD_MIN_WIDTH = 32;
const FALLBACK_DEFAULT_WIDTH = 400;

/**
 * Waits for the resize handle, which renders only on an image that loaded: without it a caller
 * could resize an image whose `load` event has not fired.
 */
export async function insertImage(ctx: SimContext, alt: string, url: string): Promise<void> {
	const { page, editor, tracker } = ctx;
	for (const ch of `![${alt}](${url})`) {
		await editor.typeSlowly(ch);
		await settleTypedSource(ctx, tracker.appendChar(ch));
	}
	await page.locator(IMAGE_WIDGET).first().click();
	await page.locator(RIGHT_HANDLE).first().waitFor({ state: 'visible' });
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Waits for the new `|N` after every press: the keydown handler works the width out from the
 * freshly serialized node, so a press that arrives before the previous commit reads a stale
 * width. One selection is enough, since it is keyed on the source offset, which a width change
 * does not move.
 */
export async function resizeImage(
	ctx: SimContext,
	direction: 'left' | 'right',
	steps: number
): Promise<void> {
	const { page, editor, tracker } = ctx;
	await page.locator(IMAGE_WIDGET).first().click();
	await page.locator(RIGHT_HANDLE).first().waitFor({ state: 'visible' });

	const start = widthFromSource(await editor.bridge.getSource());
	const delta = direction === 'right' ? KEYBOARD_STEP : -KEYBOARD_STEP;
	let expected = start;
	for (let step = 1; step <= steps; step++) {
		await page.keyboard.press(direction === 'right' ? 'Shift+ArrowRight' : 'Shift+ArrowLeft');
		expected = Math.max(KEYBOARD_MIN_WIDTH, start + delta * step);
		// Match the whole `|N]`, since a bare `|420` is the start of `|4200`.
		await editor.bridge.waitForSourceContains(`|${expected}]`);
	}
	// The width on screen, not just the `|N` in the source: the image re-renders from an effect
	// that can lag the commit, so a checkpoint screenshot could catch the old size.
	await page.waitForFunction(
		(w) => {
			const img = document.querySelector('[data-image-widget] img') as HTMLImageElement | null;
			return !!img && Math.abs(img.getBoundingClientRect().width - w) <= 1;
		},
		expected,
		{ timeout: 5000 }
	);
	tracker.resync(await editor.bridge.getSource());
}

function widthFromSource(source: string): number {
	const match = source.match(/\|(\d+)\]/);
	return match ? Number(match[1]) : FALLBACK_DEFAULT_WIDTH;
}
