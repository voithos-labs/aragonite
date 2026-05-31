import type { SimContext } from '../invariants';

/**
 * Structural gestures that trigger editor auto-behavior — indent/outdent renumber
 * and re-nest the tree, a task toggle rewrites the marker. None are predictable
 * char-by-char, so each performs a real key/pointer action, settles on the source
 * changing from its pre-gesture snapshot, then resyncs the tracker to the observed
 * result. The "source differs from the snapshot" predicate is direction-agnostic
 * (handles indent and outdent, [ ]→[x] and [x]→[ ]) and needs no computed target.
 *
 * Each gesture's precondition is the fixture's contract: indent assumes a nestable
 * list item, toggleTask assumes a task item at `listItemPath`. An invalid context
 * is a no-op that leaves the source unchanged, so the settle times out and the
 * gesture fails loudly rather than silently recording a stale state as truth.
 */

/**
 * Press Enter where the keystroke mutates the source without splitting off a new
 * top-level block — a newline inside a fenced code body, or the collapse that
 * lifts the caret out of an empty trailing list item. The frozen `pressEnter`
 * settles on a block-host count increment, which neither case produces (the code
 * body shares one host; the list-exit collapse removes a host). This settles on
 * the source delta instead, the one observable both share.
 */
export async function softEnter(ctx: SimContext): Promise<void> {
	await actThenResync(ctx, () => ctx.page.keyboard.press('Enter'));
}

/**
 * Tab to nest the current item one level deeper. The editor drops the caret to
 * column 0 of the re-nested item, so this restores it to end-of-line afterward —
 * an item the user just indented is one they're still writing, and a stranded
 * column-0 caret would split the item on the next Enter.
 */
export async function indent(ctx: SimContext): Promise<void> {
	await actThenResync(ctx, () => ctx.page.keyboard.press('Tab'));
	await ctx.page.keyboard.press('End');
	await ctx.editor.waitForRenderFlush();
}

export async function outdent(ctx: SimContext): Promise<void> {
	await actThenResync(ctx, () => ctx.page.keyboard.press('Shift+Tab'));
}

/**
 * Open a blockquote by typing `>` then `text`. The `>` keystroke reclassifies the
 * block, and the editor inserts the canonical single space after it the moment
 * the first body character arrives — so the typed `>text` lands as `> text`. That
 * one-time space is auto-behavior the printable tracker can't predict, so this
 * settles on the body appearing in the source and resyncs rather than typing the
 * body char-by-char. Fixtures pass `text` without a leading space.
 */
export async function startQuote(ctx: SimContext, text: string): Promise<void> {
	const { editor, tracker } = ctx;
	await editor.typeSlowly('>');
	await editor.bridge.waitForSourceContains('>');
	await editor.typeSlowly(text);
	await editor.bridge.waitForSourceContains(text);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Real pointer click on the task checkbox of the list item at `listItemPath`.
 * The descendant selector also matches checkboxes in sub-lists nested under the
 * item, but the item's own checkbox renders on its first-child paragraph (ahead
 * of any sub-list in DOM order), so `.first()` resolves to it.
 */
export async function toggleTask(ctx: SimContext, listItemPath: number[]): Promise<void> {
	const pathAttr = JSON.stringify(listItemPath);
	const checkbox = ctx.page.locator(`[data-block-path='${pathAttr}'] .task-checkbox`).first();
	await actThenResync(ctx, () => checkbox.click());
}

async function actThenResync(ctx: SimContext, act: () => Promise<void>): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await act();
	await ctx.editor.bridge.waitForSourceWith((source, prev) => source !== prev, before);
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}
