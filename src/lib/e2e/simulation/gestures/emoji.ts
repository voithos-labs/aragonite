import { type SimContext } from '../invariants';
import { arrowRightToOffset, cursorOffset } from './caret-walk';

// Gestures for the emoji shortcode widget (plugins route, `?seed=emoji`). The widget shows the
// emoji, not the shortcode it came from, and the shortcode is typed mid-sentence, so the
// expected answer can predict neither the insert nor the delete: both wait for the widget and
// resync. Built like the decoded-entity widget, so these mirror gestures/entity.ts.

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
 * The caret is placed through the Selection API for setup only; the shortcode itself is typed
 * one key at a time, so the widget appears on the closing `:`. `shortcode` is the bare name,
 * with no colons.
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
 * The `onEdge: 'step-over'` rule has to cross the whole widget in one press each way, so a
 * press that lands inside it, at an offset between its start and end, throws.
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
 * The caret reaches its trailing edge by real arrow presses, so the delete takes that path.
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
