import { type SimContext, settleTypedSource } from '../invariants';

// Image gestures. Free functions taking `ctx` first so the Gestures class can
// delegate to them without growing its frozen surface. Each types or resizes
// through real keyboard/mouse, gates on the loaded widget, and resyncs the
// tracker after the editor's `|N` auto-rewrite.

const IMAGE_WIDGET = '[data-image-widget]';
const RIGHT_HANDLE = '.md-resize-handle-right';

// Mirrors the widget's keyboard-resize constants (components/image/): each
// Shift+Arrow steps 20px and width never falls below 32 (an unsized image steps
// from 400).
const KEYBOARD_STEP = 20;
const KEYBOARD_MIN_WIDTH = 32;
const FALLBACK_DEFAULT_WIDTH = 400;

/**
 * Type `![alt](url)` char-by-char (each char predicted via the tracker), then
 * gate on the loaded widget — select it and wait for the right resize handle,
 * which only renders on a non-broken image — before returning. The load gate
 * keeps a caller from resizing a widget whose `load` event hasn't fired.
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
 * Select the image widget, then Shift+Arrow `steps` times to grow (right) or
 * shrink (left) the width by 20px each. Settles on the new `|N` after every
 * press: the keydown handler recomputes width from the freshly-serialized node,
 * so a press that lands before the prior commit flushed would read a stale
 * width and under-count. One select suffices for all presses — widget selection
 * is keyed on the image's source offset, which a width change doesn't move.
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
	// Settle on the RENDERED width, not just the source `|N`: the widget re-renders
	// from the new raw on a reactive effect that can lag the source commit, so a
	// checkpoint screenshot taken on the source alone may catch the image still at
	// its pre-resize size.
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
