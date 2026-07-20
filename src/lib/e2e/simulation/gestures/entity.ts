import { type SimContext } from '../invariants';

// Decoded-entity atomic-widget gestures. A character reference like `&copy;`
// renders as an atomic `[data-inline-widget]` glyph (©) while the raw stays the
// literal six bytes on `data-source-*`. The widget contributes its glyph, not its
// raw, to textContent, so the ExpectationTracker's end-of-doc append rule can't
// predict a mid-prose insert or the whole-reference atomic delete — both perform,
// settle on the widget swap, and resync. Free functions taking `ctx` first,
// mirroring gestures/decoration.ts.

const ENTITY = '.md-entity-widget';

async function entitySpan(ctx: SimContext, blockIndex: number): Promise<{ end: number }> {
	const span = await ctx.page.evaluate((i) => {
		const host = document.querySelector(`[data-block-path='${JSON.stringify([i])}']`);
		const widget = host?.querySelector('.md-entity-widget');
		return widget ? { end: Number(widget.getAttribute('data-source-end')) } : null;
	}, blockIndex);
	if (!span || !Number.isInteger(span.end)) {
		throw new Error(`[${ctx.label}] no entity widget in block ${blockIndex}`);
	}
	return span;
}

async function cursorOffset(ctx: SimContext, blockIndex: number): Promise<number | null> {
	return ctx.page.evaluate(
		(i) => (window as any).__test.getBlockCursorSurface([i]).cursorOffset,
		blockIndex
	);
}

/**
 * Type a character reference mid-prose in `blockIndex`, materializing an atomic
 * glyph widget. The caret is placed at `offset` (mid-block) with the Selection API
 * for setup, then the reference is typed with real per-key input; the widget
 * appears on the closing `;`. Settles on the glyph mounting plus the literal
 * reference landing in the source, then resyncs.
 */
export async function typeEntityWidget(
	ctx: SimContext,
	blockIndex: number,
	offset: number,
	reference: string
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const glyphsBefore = await page.locator(ENTITY).count();

	await editor.focusBlockAtPath([blockIndex], offset);
	await editor.typeSlowly(reference);
	await page.locator(ENTITY).nth(glyphsBefore).waitFor({ state: 'visible' });
	await editor.bridge.waitForSourceContains(reference);
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Delete the entity widget in `blockIndex` with a single atomic Backspace from its
 * trailing edge — `deleteGranularity: 'atomic'` removes the whole reference in one
 * press and one undo entry. The caret walks to the trailing edge with real arrows
 * (widget-aware: one ArrowRight steps over the whole glyph), so the press lands on
 * the atomic-delete branch. Settles on the glyph unmounting and the reference
 * leaving the source, then resyncs.
 */
export async function atomicDeleteEntityWidget(ctx: SimContext, blockIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const { end } = await entitySpan(ctx, blockIndex);
	const before = await editor.bridge.getSource();
	const glyphsBefore = await page.locator(ENTITY).count();

	await editor.focusBlockStart(blockIndex);
	for (let guard = 0; guard <= end + 8; guard++) {
		if ((await cursorOffset(ctx, blockIndex)) === end) break;
		await page.keyboard.press('ArrowRight');
	}
	if ((await cursorOffset(ctx, blockIndex)) !== end) {
		throw new Error(`[${ctx.label}] could not reach the entity's trailing edge (offset ${end})`);
	}

	await page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	if ((await page.locator(ENTITY).count()) !== glyphsBefore - 1) {
		throw new Error(`[${ctx.label}] the atomic backspace did not remove exactly one entity glyph`);
	}
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}
