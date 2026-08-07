import { type SimContext, settleTypedSource } from '../invariants';

/**
 * Structural gestures trigger editor auto-behavior, so none are predictable char-by-char:
 * each acts, settles on the source DIFFERING from its pre-gesture snapshot, then resyncs.
 * That predicate is direction-agnostic and needs no computed target. Preconditions are the
 * fixture's contract — an invalid context is a no-op, so the settle times out and the
 * gesture fails loudly rather than recording a stale state as truth.
 */

/**
 * Enter where the keystroke mutates the source WITHOUT splitting off a top-level block.
 * `pressEnter` settles on a block-host increment, which neither case produces — a code body
 * shares one host and the list-exit collapse removes one — so this settles on the delta.
 */
export async function softEnter(ctx: SimContext): Promise<void> {
	await actThenResync(ctx, () => ctx.page.keyboard.press('Enter'));
}

/**
 * The only gesture that authors a hard line break INSIDE a paragraph. It must reach BACKWARD
 * into typed text: Shift+Enter at end-of-block leaves a bare trailing backslash, so no
 * forward-only cadence produces the shape. Leaves the caret mid-block, which the tracker's
 * document-end model cannot type against — use it as a note's LAST build gesture.
 */
export async function hardBreakAt(
	ctx: SimContext,
	blockPath: number[],
	offset: number
): Promise<void> {
	await ctx.editor.clickBlockAtPath(blockPath, offset);
	await actThenResync(ctx, () => ctx.page.keyboard.press('Shift+Enter'));
}

/**
 * The editor drops the caret to column 0 of the re-nested item, so this restores it to
 * end-of-line: a stranded column-0 caret would split the item on the next Enter.
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
 * A reorder permutes siblings without changing their count, so it settles on the source
 * delta. A no-op move (already at an end) leaves the source unchanged and fails loudly.
 */
export async function reorder(ctx: SimContext, blockIndex: number, dir: -1 | 1): Promise<void> {
	await ctx.editor.clickBlock(blockIndex);
	await ctx.editor.waitForRenderFlush();
	await actThenResync(ctx, () =>
		ctx.page.keyboard.press(dir < 0 ? 'Alt+ArrowUp' : 'Alt+ArrowDown')
	);
}

/**
 * The resolver declines at the opaque boundary, so both directions are a byte-exact no-op.
 * Driving it puts the DECLINE path under the corruption oracle: a regression to the teleport
 * permutes the top-level array, and the no-change guard throws. `bodyPath` must be a body
 * leaf, never the reserved chrome (which binds no Alt+Arrow).
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
 * Indenting the EMPTY item Enter just created is what lifts the two-level ceiling a filled
 * item hits; the cadence is `pressEnter` → this → `typeFreshItem`. An empty item's marker is
 * trimmed at every depth, so the source does not change — hence a settle on the FOCUSED
 * item's path lengthening (a global-deepest poll would false-fire on a deeper list earlier
 * in the document), and no resync until `typeFreshItem` materializes the marker.
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
 * The mirror of `indentEmptyItem`, settling the same way and for the same reason: the
 * source-delta `outdent` would hang here, since an empty item's trimmed marker means no
 * delta unless the outdent crosses a list-exit boundary.
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
 * The first body char MATERIALIZES the trimmed marker, so the source grows by more than the
 * typed char (the blockquote-canonical-space class) — that char settles on a delta and
 * resyncs, and the rest predicts normally. Correct at any depth. No typo injection here.
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
 * The editor inserts a canonical space once the first body char arrives, so typed `>text`
 * lands as `> text` — unpredictable, so this settles on the body and resyncs. Fixtures pass
 * `text` without a leading space.
 */
export async function startQuote(ctx: SimContext, text: string): Promise<void> {
	const { editor, tracker } = ctx;
	await editor.typeSlowly('>');
	await editor.typeSlowly(text);
	// The whole line, not a bare `>`: that would land before reclassification commits and
	// could resync a half-applied source.
	await editor.bridge.waitForSourceContains(`> ${text}`);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Enter inside a quote adds a soft line break, not a top-level block, so `pressEnter` would
 * mis-settle on a block-host increment. The auto-inserted `> ` marker means this settles on
 * the whole line and resyncs. Fixtures pass `text` without a leading `>` or space.
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
 * The editor materializes both canonical spaces as the body arrives, so this types `>` then
 * the body with NO manual spaces and settles on the whole line, like `startQuote`. Puts a
 * `> >` nested quote in the equality spine — the guard the quote-exit fix lacked.
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
 * The descendant selector also matches checkboxes in nested sub-lists, but the item's own
 * renders on its first-child paragraph, ahead of them in DOM order — hence `.first()`.
 */
export async function toggleTask(ctx: SimContext, listItemPath: number[]): Promise<void> {
	const pathAttr = JSON.stringify(listItemPath);
	const checkbox = ctx.page.locator(`[data-block-path='${pathAttr}'] .task-checkbox`).first();
	await actThenResync(ctx, () => checkbox.click());
}

/**
 * The one insert that starts from no block at all: Backspace at `boundaryIndex`'s offset 0
 * parks the between-blocks caret, and the next key mints a paragraph there (empty `text` =
 * Enter). Both halves are asserted, or an arrival that entered the block would record an
 * ordinary edit as gap coverage. `boundaryIndex` must name a block whose leading boundary
 * both neighbours declare, and the mint leaves the caret mid-document — a note's LAST gesture.
 */
export async function mintAtGap(
	ctx: SimContext,
	boundaryIndex: number,
	text: string
): Promise<void> {
	await ctx.editor.clickBlockAtPath([boundaryIndex], 0);
	await ctx.page.keyboard.press('Backspace');
	try {
		await ctx.editor.bridge.waitForGapCaret({ parentPath: [], index: boundaryIndex });
	} catch {
		throw new Error(
			`[${ctx.label}] mintAtGap: Backspace at block ${boundaryIndex} parked no gap caret ` +
				`there, got ${JSON.stringify(await ctx.editor.bridge.getGapCaret())}; both ` +
				`neighbours must declare the facing edge.`
		);
	}
	await actThenResync(ctx, async () => {
		if (text) await ctx.editor.typeSlowly(text);
		else await ctx.page.keyboard.press('Enter');
		// The mint's own focus of the new block is what ends the gap; without it the keys
		// still belong to the proxy and the "minted" bytes came from somewhere else.
		await ctx.editor.bridge.waitForGapCaret(null);
	});
}

async function actThenResync(ctx: SimContext, act: () => Promise<void>): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await act();
	await ctx.editor.bridge.waitForSourceWith((source, prev) => source !== prev, before);
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}
