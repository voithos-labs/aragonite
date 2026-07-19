import { type SimContext, settleTypedSource } from '../invariants';

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
 * Move the top-level block at `blockIndex` up/down among its siblings via the
 * Alt+ArrowUp/Down reorder chord. A reorder permutes siblings without changing
 * their count, so it settles on the source delta (the permutation) and resyncs.
 * A no-op move (already at an end) leaves the source unchanged, so the settle
 * times out and the gesture fails loudly.
 */
export async function reorder(ctx: SimContext, blockIndex: number, dir: -1 | 1): Promise<void> {
	await ctx.editor.clickBlock(blockIndex);
	await ctx.editor.waitForRenderFlush();
	await actThenResync(ctx, () =>
		ctx.page.keyboard.press(dir < 0 ? 'Alt+ArrowUp' : 'Alt+ArrowDown')
	);
}

/**
 * Attempt a reorder on a block leaf INSIDE a plugin (opaque) container via
 * Alt+Arrow. The resolver declines at the opaque boundary, so both directions are
 * a clean no-op — nothing commits and the source stays byte-identical. Driving it
 * puts the decline path under the corruption oracle: a regression to the pre-fix
 * teleport would permute the top-level array and change the source, so the
 * no-change guard throws loudly instead of recording a corrupted tree as truth.
 * `bodyPath` is a body leaf, never the reserved chrome (which binds no Alt+Arrow).
 */
export async function reorderInContainer(ctx: SimContext, bodyPath: number[]): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await ctx.editor.clickBlockAtPath(bodyPath, 0);
	await ctx.page.keyboard.press('Alt+ArrowUp');
	await ctx.page.keyboard.press('Alt+ArrowDown');
	await ctx.editor.waitForNoSourceMutation();
	const after = await ctx.editor.bridge.getSource();
	if (after !== before) {
		throw new Error(
			`reorderInContainer: expected an opaque-boundary no-op, but the source changed:\n${before}\n→\n${after}`
		);
	}
	ctx.tracker.resync(after);
}

/**
 * Tab to nest a freshly-created EMPTY list item one level deeper, the move that
 * lifts the two-level ceiling. Indenting a filled trailing item doesn't nest it
 * under its sibling, but indenting the empty item Enter just created does — so the
 * deep-nesting cadence is `pressEnter` → this → `typeFreshItem`, repeated. Unlike
 * `indent`, this can't settle on a source delta: an empty item's marker is trimmed
 * at every depth, so the nest leaves the serialized source unchanged. It settles on
 * the FOCUSED item's path growing deeper — the indent wraps the item in a new nested
 * list, so its own path strictly lengthens regardless of how deep other regions of
 * the note already are (a global-deepest poll would false-fire when a deeper list
 * sits earlier in the document). It does NOT resync: the source is unchanged here;
 * the marker (and its resync) materializes on `typeFreshItem`'s first char. A no-op
 * indent (already at the editor's nest cap) leaves the path unchanged, so the settle
 * times out and the gesture fails loudly.
 */
export async function indentEmptyItem(ctx: SimContext): Promise<void> {
	const before = await ctx.editor.bridge.getSelectionPaths();
	const baseline = before?.focus.path.length ?? 0;
	await ctx.page.keyboard.press('Tab');
	await ctx.page.waitForFunction(
		(min) => {
			const sel = (window as any).__test?.getSelectionPaths?.();
			return (sel?.focus?.path?.length ?? 0) > min;
		},
		baseline,
		{ timeout: 2000, polling: 16 }
	);
	await ctx.page.keyboard.press('End');
	await ctx.editor.waitForRenderFlush();
}

/**
 * The mirror of `indentEmptyItem`: lift a freshly-created EMPTY list item one level
 * back out, the move that returns to a shallower branch after typing a deep one. An
 * empty item trims its marker at every depth, so the outdent leaves the serialized
 * source unchanged and the source-delta `outdent` would hang waiting for a delta
 * that never comes (it only sees one when the outdent crosses a list-exit boundary).
 * This settles on the FOCUSED item's path strictly SHORTENING — the unnest unwraps
 * the item from its enclosing nested list. Like `indentEmptyItem`, it does NOT
 * resync: the marker (and its resync) materializes on the next `typeFreshItem`'s
 * first char. A no-op outdent (already at top level) leaves the path unchanged, so
 * the settle times out and the gesture fails loudly.
 */
export async function outdentEmptyItem(ctx: SimContext): Promise<void> {
	const before = await ctx.editor.bridge.getSelectionPaths();
	const baseline = before?.focus.path.length ?? 0;
	await ctx.page.keyboard.press('Shift+Tab');
	await ctx.page.waitForFunction(
		(max) => {
			const sel = (window as any).__test?.getSelectionPaths?.();
			const len = sel?.focus?.path?.length ?? Infinity;
			return len < max;
		},
		baseline,
		{ timeout: 2000, polling: 16 }
	);
	await ctx.page.keyboard.press('End');
	await ctx.editor.waitForRenderFlush();
}

/**
 * Type the first line of a freshly-created list item — the one case the printable
 * tracker can't predict. An empty nested item trims its marker in the serialized
 * source, so the first body char makes the editor MATERIALIZE the marker and the
 * source grows by more than the typed char (same class as the blockquote canonical
 * space). The first char therefore settles on a source delta and resyncs, exactly
 * like the auto-behavior gestures; the rest of `text` predicts normally because the
 * item is now the last block and the caret sits at end-of-content. Use for every
 * Enter-created item — it is correct at any depth, including top level, where the
 * delta is just the typed char. Deterministic: no typo injection on this path.
 */
export async function typeFreshItem(ctx: SimContext, text: string): Promise<void> {
	const { editor, tracker } = ctx;
	if (text.length === 0) return;
	const before = await editor.bridge.getSource();
	await editor.typeSlowly(text[0]);
	await editor.bridge.waitForSourceWith((source, prev) => source !== prev, before);
	tracker.resync(await editor.bridge.getSource());
	for (const ch of text.slice(1)) {
		await editor.typeSlowly(ch);
		await settleTypedSource(ctx, tracker.appendChar(ch));
	}
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
	await editor.typeSlowly(text);
	// Settle on the whole `> ${text}` line: the canonical space appears only once
	// the body arrives and reclassification commits, so a bare `>` settle would
	// land before the block became a blockquote and could resync a half-applied
	// source.
	await editor.bridge.waitForSourceContains(`> ${text}`);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Continue an open blockquote onto a new line. Pressing Enter inside a quote keeps
 * the caret in the quote and auto-inserts the `> ` continuation marker, so this
 * adds a soft line break (same paragraph) rather than a new top-level block — the
 * frozen `pressEnter` would mis-settle on a block-host increment. The Enter and the
 * marker are auto-behavior, so this types the body afterward, settles on the whole
 * `> ${text}` line appearing, and resyncs. Fixtures pass `text` without a leading
 * `>` or space. Use after `startQuote` (or another `continueQuote`) to build a
 * multi-line single-paragraph blockquote.
 */
export async function continueQuote(ctx: SimContext, text: string): Promise<void> {
	const { editor, tracker } = ctx;
	await editor.page.keyboard.press('Enter');
	await editor.typeSlowly(text);
	await editor.bridge.waitForSourceContains(`> ${text}`);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Nest one level deeper inside an open blockquote, producing a `> > ${text}` line.
 * Enter continues the outer quote, then a typed `>` reclassifies the continuation
 * into a nested quote — the editor materializes both canonical spaces (`> > `) as
 * the body arrives, so this types `>` then the body WITHOUT manual spaces and lets
 * the editor normalize. The reclassification plus space materialization is the same
 * auto-behavior `startQuote` absorbs, so this settles on the whole `> > ${text}`
 * line and resyncs rather than predicting char-by-char. Fixtures pass `text` bare.
 * Use after `startQuote` to put a `> >` nested quote in the equality spine — the
 * regression guard the nested-blockquote-exit fix lacked.
 */
export async function nestQuote(ctx: SimContext, text: string): Promise<void> {
	const { editor, tracker } = ctx;
	await editor.page.keyboard.press('Enter');
	await editor.typeSlowly('>');
	await editor.typeSlowly(text);
	await editor.bridge.waitForSourceContains(`> > ${text}`);
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
