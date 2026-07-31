import { type SimContext, settleTypedSource } from '../invariants';

// Image gestures. Each gates on the LOADED widget and resyncs after the editor's `|N`
// auto-rewrite.

const IMAGE_WIDGET = '[data-image-widget]';
const RIGHT_HANDLE = '.md-resize-handle-right';

// Mirrors the widget's keyboard-resize constants (components/image/): each
// Shift+Arrow steps 20px and width never falls below 32 (an unsized image steps
// from 400).
const KEYBOARD_STEP = 20;
const KEYBOARD_MIN_WIDTH = 32;
const FALLBACK_DEFAULT_WIDTH = 400;

/**
 * Gates on the resize handle, which only renders on a non-broken image: without that a
 * caller could resize a widget whose `load` event has not fired.
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
 * Settles on the new `|N` after EVERY press: the keydown handler recomputes width from the
 * freshly-serialized node, so a press landing before the prior commit flushed reads a stale
 * width. One select suffices — widget selection is keyed on the source offset, which a width
 * change does not move.
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
		// Match the full `|N]` token — a bare `|420` is a prefix of `|4200`.
		await editor.bridge.waitForSourceContains(`|${expected}]`);
	}
	// The RENDERED width, not just the source `|N`: the widget re-renders on an effect that
	// can lag the commit, so a checkpoint screenshot could catch the pre-resize size.
	await page.waitForFunction(
		(w) => {
			const img = document.querySelector('[data-image-widget] img') as HTMLImageElement | null;
			return !!img && Math.abs(img.getBoundingClientRect().width - w) <= 1;
		},
		expected,
		{ timeout: 2000 }
	);
	tracker.resync(await editor.bridge.getSource());
}

function widthFromSource(source: string): number {
	const match = source.match(/\|(\d+)\]/);
	return match ? Number(match[1]) : FALLBACK_DEFAULT_WIDTH;
}
