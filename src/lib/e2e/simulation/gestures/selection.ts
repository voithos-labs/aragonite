import { primaryModifier } from '../../platform';
import type { SimContext } from '../invariants';

/**
 * Selection, clipboard, and inline-format gestures. The mutating ones settle on a SOURCE
 * DELTA against the pre-chord source, never on a marker substring: the fixtures already
 * contain `*`/`**`, so a containment predicate would fire before the format committed and
 * resync a stale source.
 */

// ── Selection ───────────────────────────────────────────────────────────────

/**
 * Leftward by default: after typing the caret sits at end-of-content, so a leftward extension
 * selects what was just typed. Negative `count` extends rightward.
 */
export async function selectChars(ctx: SimContext, count: number): Promise<void> {
	const key = count < 0 ? 'Shift+ArrowRight' : 'Shift+ArrowLeft';
	for (let i = 0; i < Math.abs(count); i++) {
		await ctx.page.keyboard.press(key);
	}
	await ctx.editor.waitForRenderFlush();
}

// ── Edit ────────────────────────────────────────────────────────────────────

/** Select `count` chars, Delete the selection, resync (deletion is auto-behavior). */
export async function selectAndDelete(ctx: SimContext, count: number): Promise<void> {
	await selectChars(ctx, count);
	await mutateThenResync(ctx, () => ctx.page.keyboard.press('Delete'));
}

// ── Clipboard ───────────────────────────────────────────────────────────────

/** Copy mutates nothing, so it settles on the clipboard write and skips the resync. */
export async function copySelection(ctx: SimContext): Promise<void> {
	await ctx.page.keyboard.press(`${primaryModifier}+c`);
	await ctx.editor.waitForClipboardWrite();
}

/** Paste at the caret, settle on the source delta, resync. */
export async function pasteHere(ctx: SimContext): Promise<void> {
	await mutateThenResync(ctx, () => ctx.page.keyboard.press(`${primaryModifier}+v`));
}

// ── Inline format ───────────────────────────────────────────────────────────

/** Wrap (or unwrap) the current selection in `**`, settle on the source delta, resync. */
export async function applyBold(ctx: SimContext): Promise<void> {
	await mutateThenResync(ctx, () => ctx.page.keyboard.press(`${primaryModifier}+b`));
}

/** Wrap (or unwrap) the current selection in `*`, settle on the source delta, resync. */
export async function applyItalic(ctx: SimContext): Promise<void> {
	await mutateThenResync(ctx, () => ctx.page.keyboard.press(`${primaryModifier}+i`));
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * The delta predicate MARSHALS `before` into the browser via `waitForSourceWith`: a closure
 * over it would serialize as `undefined` and resolve instantly.
 */
async function mutateThenResync(ctx: SimContext, chord: () => Promise<void>): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await chord();
	await ctx.editor.bridge.waitForSourceWith((source, prior) => source !== prior, before);
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}
