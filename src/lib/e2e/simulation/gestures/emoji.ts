import { type SimContext } from '../invariants';
import { arrowRightToOffset, cursorOffset } from './caret-walk';

// Emoji shortcode atomic-widget gestures (plugins route, `?seed=emoji`). The widget
// contributes its GLYPH, not its raw, and the shortcode is typed MID-prose, so the tracker's
// end-of-doc append rule can predict neither the insert nor the atomic delete — both settle
// on the widget swap and resync. The decoded-entity mold, so these mirror gestures/entity.ts.

const EMOJI = '.md-emoji-widget';

async function emojiSpan(
	ctx: SimContext,
	blockIndex: number
): Promise<{ start: number; end: number }> {
	const span = await ctx.page.evaluate((i) => {
		const host = document.querySelector(`[data-block-path='${JSON.stringify([i])}']`);
		const widget = host?.querySelector('.md-emoji-widget');
		return widget
			? {
					start: Number(widget.getAttribute('data-source-start')),
					end: Number(widget.getAttribute('data-source-end'))
				}
			: null;
	}, blockIndex);
	if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.end)) {
		throw new Error(`[${ctx.label}] no emoji widget in block ${blockIndex}`);
	}
	return span;
}

/**
 * The caret is placed with the Selection API for SETUP only; the shortcode itself is typed
 * per-key, so the widget appears on the closing `:`. `shortcode` is the bare name, no colons.
 */
export async function typeEmojiShortcode(
	ctx: SimContext,
	blockIndex: number,
	offset: number,
	shortcode: string
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const glyphsBefore = await page.locator(EMOJI).count();

	await editor.focusBlockAtPath([blockIndex], offset);
	await editor.typeSlowly(`:${shortcode}:`);
	await page.locator(EMOJI).nth(glyphsBefore).waitFor({ state: 'visible' });
	await editor.bridge.waitForSourceContains(`:${shortcode}:`);
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * The `onEdge: 'step-over'` policy must cross the whole atomic island in ONE press each way,
 * so a press that lands inside the island (an offset between start and end) fails loud.
 */
export async function stepOverEmoji(ctx: SimContext, blockIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const { start, end } = await emojiSpan(ctx, blockIndex);

	await arrowRightToOffset(ctx, blockIndex, start);
	await page.keyboard.press('ArrowRight');
	if ((await cursorOffset(ctx, blockIndex)) !== end) {
		throw new Error(
			`[${ctx.label}] ArrowRight did not step over the whole emoji widget [${start}, ${end}) in one press`
		);
	}
	await page.keyboard.press('ArrowLeft');
	if ((await cursorOffset(ctx, blockIndex)) !== start) {
		throw new Error(
			`[${ctx.label}] ArrowLeft did not step back over the whole emoji widget [${start}, ${end}) in one press`
		);
	}
	tracker.resync(await editor.bridge.getSource());
}

/**
 * `deleteGranularity: 'atomic'` removes the whole shortcode in one press and one undo entry.
 * The caret reaches the trailing edge with REAL arrows so the press lands on that branch.
 */
export async function atomicDeleteEmoji(ctx: SimContext, blockIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const { end } = await emojiSpan(ctx, blockIndex);
	const before = await editor.bridge.getSource();
	const glyphsBefore = await page.locator(EMOJI).count();

	await arrowRightToOffset(ctx, blockIndex, end);
	await page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	if ((await page.locator(EMOJI).count()) !== glyphsBefore - 1) {
		throw new Error(`[${ctx.label}] the atomic backspace did not remove exactly one emoji glyph`);
	}
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}
