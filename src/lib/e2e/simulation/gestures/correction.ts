import type { Gestures } from '../gestures';
import type { SimContext } from '../invariants';

/**
 * The caret lands MID-document, where the tracker's end-of-content append rule does not
 * hold, so these observe the source and resync rather than predicting.
 */

/**
 * A net-identity edit wherever the caret sits. Mid-document, so a raw keystroke plus a
 * source-delta settle is the only sound observation; leaves the document byte-identical.
 */
export async function cancellingEditAtCaret(ctx: SimContext): Promise<void> {
	const clean = await ctx.editor.bridge.getSource();
	await ctx.editor.typeSlowly('z');
	await ctx.editor.bridge.waitForSourceWith((source, prev) => source !== prev, clean);
	await ctx.editor.page.keyboard.press('Backspace');
	await ctx.editor.bridge.waitForSourceEquals(clean);
	ctx.tracker.resync(clean);
}

/**
 * `targetBlockPath` must be a single top-level index: the click asserts the focus block
 * path, since a wrong-block landing must never be recorded as truth.
 */
export async function lateCorrection(
	ctx: SimContext,
	g: Gestures,
	targetBlockPath: number[]
): Promise<void> {
	await g.clickToReposition(targetBlockPath, 0);
	await cancellingEditAtCaret(ctx);
}
