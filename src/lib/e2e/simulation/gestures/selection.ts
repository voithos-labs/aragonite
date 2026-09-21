import type { SimContext } from '../invariants';

/**
 * Selection, clipboard and inline-format gestures. The ones that change bytes wait for the
 * source to differ from what it was before the shortcut, never for a marker to appear: the
 * fixtures already contain `*` and `**`, so waiting for one would return before the format
 * committed and resync a stale source.
 */

// ── Selection ───────────────────────────────────────────────────────────────

/**
 * To the left by default: after typing, the caret sits at the end of the text, so extending
 * left selects what was just typed. A negative `count` extends to the right.
 */
export async function selectChars(ctx: SimContext, count: number): Promise<void> {
	const key = count < 0 ? 'Shift+ArrowRight' : 'Shift+ArrowLeft';
	for (let i = 0; i < Math.abs(count); i++) {
		await ctx.page.keyboard.press(key);
	}
	await ctx.editor.waitForRenderFlush();
}

// ── Edit ────────────────────────────────────────────────────────────────────

/** Select `count` characters, Delete them, resync (the editor decides what the delete does). */
export async function selectAndDelete(ctx: SimContext, count: number): Promise<void> {
	await selectChars(ctx, count);
	await mutateThenResync(ctx, () => ctx.page.keyboard.press('Delete'));
}

// ── Clipboard ───────────────────────────────────────────────────────────────

/** Copy changes nothing, so it waits on the clipboard write and skips the resync. */
export async function copySelection(ctx: SimContext): Promise<void> {
	await ctx.page.keyboard.press('ControlOrMeta+c');
	await ctx.editor.waitForClipboardWrite();
}

/** Paste at the caret, wait for the source to change, resync. */
export async function pasteHere(ctx: SimContext): Promise<void> {
	await mutateThenResync(ctx, () => ctx.page.keyboard.press('ControlOrMeta+v'));
}

// ── Inline format ───────────────────────────────────────────────────────────

/** Wrap (or unwrap) the current selection in `**`, wait for the source to change, resync. */
export async function applyBold(ctx: SimContext): Promise<void> {
	await mutateThenResync(ctx, () => ctx.page.keyboard.press('ControlOrMeta+b'));
}

/** Wrap (or unwrap) the current selection in `*`, wait for the source to change, resync. */
export async function applyItalic(ctx: SimContext): Promise<void> {
	await mutateThenResync(ctx, () => ctx.page.keyboard.press('ControlOrMeta+i'));
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * The predicate is handed `before` through `waitForSourceWith`, because a value captured in
 * the closure would arrive in the browser as `undefined` and the wait would return at once.
 */
async function mutateThenResync(ctx: SimContext, chord: () => Promise<void>): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await chord();
	await ctx.editor.bridge.waitForSourceWith((source, prior) => source !== prior, before);
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}
