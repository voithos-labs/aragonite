import { type SimContext } from '../invariants';
import { arrowRightToOffset } from './caret-walk';

// Decoded-entity atomic-widget gestures. The widget contributes its GLYPH, not its raw, so
// the tracker's end-of-doc append rule can predict neither a mid-prose insert nor the
// whole-reference atomic delete — both settle on the widget swap and resync.

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

/**
 * The caret is placed with the Selection API for SETUP only; the reference itself is typed
 * per-key, so the widget appears on the closing `;`.
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
 * `deleteGranularity: 'atomic'` removes the whole reference in one press and one undo entry.
 * The caret reaches the trailing edge with REAL arrows so the press lands on that branch.
 */
export async function atomicDeleteEntityWidget(ctx: SimContext, blockIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const { end } = await entitySpan(ctx, blockIndex);
	const before = await editor.bridge.getSource();
	const glyphsBefore = await page.locator(ENTITY).count();

	await arrowRightToOffset(ctx, blockIndex, end);
	await page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	if ((await page.locator(ENTITY).count()) !== glyphsBefore - 1) {
		throw new Error(`[${ctx.label}] the atomic backspace did not remove exactly one entity glyph`);
	}
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}
