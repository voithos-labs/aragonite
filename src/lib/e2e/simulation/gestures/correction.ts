import type { Gestures } from '../gestures';
import type { SimContext } from '../invariants';

/**
 * The caret ends up mid-document, where the expected answer's "typed at the end" rule does not
 * hold, so these gestures read the source and resync rather than predicting it.
 */

/**
 * An edit that cancels itself out, wherever the caret sits. Mid-document, so the only sound
 * check is a keystroke plus a wait for the source to change; the bytes end up identical.
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
 * `targetBlockPath` must be a single top-level index: the click checks which block ended up
 * focused, since a click in the wrong block must never be recorded as if it were right.
 */
export async function lateCorrection(
	ctx: SimContext,
	g: Gestures,
	targetBlockPath: number[]
): Promise<void> {
	await g.clickToReposition(targetBlockPath);
	await cancellingEditAtCaret(ctx);
}
