import { type SimContext } from '../invariants';

// Emoji shortcode atomic-widget gestures for the first-party emoji plugin (plugins
// route, `?seed=emoji` — the bare `:` rung is seed-gated). A `:smile:` shortcode
// renders as an atomic `.md-emoji-widget` glyph (😄) while the raw stays the literal
// seven bytes on `data-source-*`. The widget contributes its glyph, not its raw, to
// textContent, and the shortcode is typed MID-prose, so the ExpectationTracker's
// end-of-doc append rule can predict neither the insert nor the atomic delete — both
// perform, settle on the widget swap, and resync. The `deleteGranularity: 'atomic'`
// /`onEdge: 'step-over'` policy is the decoded-entity mold, so these mirror
// gestures/entity.ts, adding a both-directions step-over the entity gesture omits.

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

async function cursorOffset(ctx: SimContext, blockIndex: number): Promise<number | null> {
	return ctx.page.evaluate(
		(i) => (window as any).__test.getBlockCursorSurface([i]).cursorOffset,
		blockIndex
	);
}

async function walkTo(ctx: SimContext, blockIndex: number, target: number): Promise<void> {
	await ctx.editor.focusBlockStart(blockIndex);
	for (let guard = 0; guard <= target + 8; guard++) {
		if ((await cursorOffset(ctx, blockIndex)) === target) return;
		await ctx.page.keyboard.press('ArrowRight');
	}
	throw new Error(
		`[${ctx.label}] could not walk the caret to offset ${target} in block ${blockIndex}`
	);
}

/**
 * Type a `:shortcode:` mid-prose in `blockIndex`, materializing an atomic glyph
 * widget. The caret is placed at `offset` (mid-block) with the Selection API for
 * setup, then the shortcode is typed with real per-key input; the widget appears on
 * the closing `:`. Settles on the glyph mounting plus the literal bytes landing in the
 * source, then resyncs. `shortcode` is the bare name (no colons), e.g. `tada`.
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
 * Step the caret over the emoji widget in `blockIndex` in BOTH directions with plain
 * arrows — the `onEdge: 'step-over'` policy crosses the whole atomic island in one
 * press each way. Walks to the widget's leading edge, then one ArrowRight must land on
 * the trailing edge (the full span crossed in a single press) and one ArrowLeft must
 * return to the leading edge. A press that landed inside the island (offset between
 * start and end) fails loud. Arrows move no byte, so the tracker resyncs to the
 * unchanged source rather than predicting.
 */
export async function stepOverEmoji(ctx: SimContext, blockIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const { start, end } = await emojiSpan(ctx, blockIndex);

	await walkTo(ctx, blockIndex, start);
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
 * Delete the emoji widget in `blockIndex` with a single atomic Backspace from its
 * trailing edge — `deleteGranularity: 'atomic'` removes the whole shortcode in one
 * press and one undo entry. The caret walks to the trailing edge with real arrows
 * (widget-aware: one ArrowRight steps over the whole glyph), so the press lands on the
 * atomic-delete branch. Settles on the glyph unmounting and the shortcode leaving the
 * source, then resyncs.
 */
export async function atomicDeleteEmoji(ctx: SimContext, blockIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const { end } = await emojiSpan(ctx, blockIndex);
	const before = await editor.bridge.getSource();
	const glyphsBefore = await page.locator(EMOJI).count();

	await walkTo(ctx, blockIndex, end);
	await page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	if ((await page.locator(EMOJI).count()) !== glyphsBefore - 1) {
		throw new Error(`[${ctx.label}] the atomic backspace did not remove exactly one emoji glyph`);
	}
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}
