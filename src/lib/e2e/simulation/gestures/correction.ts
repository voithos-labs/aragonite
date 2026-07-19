import type { Gestures } from '../gestures';
import type { SimContext } from '../invariants';

/**
 * Late-correction gestures: model "notice an earlier typo and go fix it." The
 * caret lands mid-document, where the printable tracker's end-of-content append
 * rule doesn't hold, so these observe the source directly and resync rather than
 * predicting — the proven pattern for any edit away from the tail.
 */

/**
 * A net-identity edit at wherever the caret currently sits: type one char, settle
 * on the source changing, Backspace it out, settle back on the clean source, resync
 * to it. The tracker's append rule inserts at end-of-content, but this caret is
 * mid-document, so a raw keystroke plus a source-delta settle is the only sound
 * observation. Leaves the document byte-identical, so end-state equality survives.
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
 * Click back into an earlier top-level block and make a cancelling edit there. The
 * click reuses `clickToReposition`, which asserts the focus block path — a
 * wrong-block landing must never be recorded as truth — so `targetBlockPath` must
 * be a single top-level index. Nets to identity, leaving the document unchanged.
 */
export async function lateCorrection(
	ctx: SimContext,
	g: Gestures,
	targetBlockPath: number[]
): Promise<void> {
	await g.clickToReposition(targetBlockPath, 0);
	await cancellingEditAtCaret(ctx);
}
