import { type SimContext, settleTypedSource } from '../invariants';

/**
 * Structural gestures set off behaviour of the editor's own, so none can be predicted character
 * by character: each acts, waits for the source to differ from what it was, then resyncs. That
 * wait works whatever the change was and needs no worked-out target. Whether the gesture makes
 * sense here is the fixture's business: in the wrong place it does nothing, so the wait times
 * out and the gesture throws rather than recording a stale state.
 */

/**
 * Enter where the key changes the source without splitting off a new top-level block.
 * `pressEnter` waits for the block count to rise, which neither case does: a code body shares
 * one block, and leaving a list removes one. So this waits for the source to change instead.
 */
export async function softEnter(ctx: SimContext): Promise<void> {
	await actThenResync(ctx, () => ctx.page.keyboard.press('Enter'));
}

/**
 * A fence typed at the end of the document completes itself: the closing line, an empty body
 * line, and the language picker, which Enter dismisses. The closing line is held past the
 * caret, so the body the note types next is predicted in front of it.
 */
export async function typeFenceOpener(ctx: SimContext): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	await editor.typeSlowly('```');
	await editor.bridge.waitForSourceWith((source, prev) => source !== prev, before);
	// Live mode completes the fence on the third backtick, the other modes on the Enter after it.
	if (!(await editor.bridge.getSource()).includes('```\n\n```')) {
		await page.keyboard.press('Enter');
	}
	await editor.bridge.waitForSourceContains('```\n\n```');
	await editor.waitForRenderFlush();
	const picker = page.locator('.code-lang-picker input');
	if (await picker.isVisible()) {
		await page.keyboard.press('Enter');
		await picker.waitFor({ state: 'hidden' });
	}
	tracker.resync(await editor.bridge.getSource());
	tracker.holdTwin('\n```');
}

/** Enter on the fence's empty last line leaves the block, using up the held closing line. */
export async function exitFence(ctx: SimContext): Promise<void> {
	await actThenResync(ctx, () => ctx.page.keyboard.press('Enter'));
	ctx.tracker.releaseTwin();
}

/**
 * The only gesture that writes a hard line break inside a paragraph. It has to reach back into
 * text already typed: Shift+Enter at the end of a block leaves a bare trailing backslash, so
 * typing forwards never produces the shape. Leaves the caret mid-block, which the expected
 * answer cannot type against, so use it as a note's last build gesture.
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
 * The editor leaves the caret at column 0 of the re-nested item, so this puts it back at the
 * end of the line: left at column 0, the next Enter would split the item.
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
 * A move swaps two blocks without changing how many there are, so it waits for the source to
 * change. A move that does nothing, because the block is already at one end, throws.
 */
export async function reorder(ctx: SimContext, blockIndex: number, dir: -1 | 1): Promise<void> {
	await ctx.editor.clickBlock(blockIndex);
	await ctx.editor.waitForRenderFlush();
	await actThenResync(ctx, () =>
		ctx.page.keyboard.press(dir < 0 ? 'Alt+ArrowUp' : 'Alt+ArrowDown')
	);
}

/**
 * The move is refused at the edge of an opaque container, so both directions change no bytes.
 * Running it puts that refusal under the simulation's checks: if the block ever jumped out
 * again, the top-level order would change and the no-change check would throw. `bodyPath` must
 * be a block in the body, never the container's title row, which binds no Alt+Arrow.
 */
export async function reorderInContainer(ctx: SimContext, bodyPath: number[]): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await ctx.editor.clickBlockAtPath(bodyPath, 0);
	await ctx.editor.pressDeclined('Alt+ArrowUp');
	await ctx.editor.pressDeclined('Alt+ArrowDown');
	const after = await ctx.editor.bridge.getSource();
	if (after !== before) {
		throw new Error(
			`reorderInContainer: expected an opaque-boundary no-op, but the source changed:\n${before}\n→\n${after}`
		);
	}
	ctx.tracker.resync(after);
}

/**
 * Indenting the empty item Enter just made is what gets past the two levels an item with text
 * stops at; the sequence is `pressEnter`, this, `typeFreshItem`. An empty item's marker is
 * trimmed at every depth, so the source does not change. Hence the wait on the focused item's
 * path growing longer, since looking for the deepest item anywhere would match a deeper list
 * earlier in the document, and no resync until `typeFreshItem` brings the marker back.
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
		{ timeout: 5000, polling: 16 }
	);
	await ctx.page.keyboard.press('End');
	await ctx.editor.waitForRenderFlush();
}

/**
 * The opposite of `indentEmptyItem`, waiting the same way and for the same reason: `outdent`,
 * which waits for the source to change, would hang here, since an empty item's trimmed marker
 * means nothing changes unless the outdent leaves the list altogether.
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
		{ timeout: 5000, polling: 16 }
	);
	await ctx.page.keyboard.press('End');
	await ctx.editor.waitForRenderFlush();
}

/**
 * The first character of the body brings back the trimmed marker, so the source grows by more
 * than the character typed: that one waits for the change and resyncs, and the rest is
 * predicted as usual. Works at any depth. No typos are injected here.
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
 * The editor adds a space once the first character of the body arrives, so typed `>text` lands
 * as `> text`. That cannot be predicted, so this waits for the body and resyncs. Fixtures pass
 * `text` without a leading space.
 */
export async function startQuote(ctx: SimContext, text: string): Promise<void> {
	const { editor, tracker } = ctx;
	await editor.typeSlowly('>');
	await editor.typeSlowly(text);
	// Waits for the whole line, not a bare `>`: that would match before the block finished
	// changing kind and could resync a half-written source.
	await editor.bridge.waitForSourceContains(`> ${text}`);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Enter inside a quote adds a line to it rather than a top-level block, so `pressEnter` would
 * wait on a block count that never rises. The editor adds the `> ` marker itself, so this waits
 * for the whole line and resyncs. Fixtures pass `text` without a leading `>` or space.
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
 * The editor adds both spaces as the body arrives, so this types `>` and then the body with no
 * spaces of its own and waits for the whole line, like `startQuote`. It puts a `> >` nested
 * quote in the end-state check, which is what leaving a quote lacked a test for.
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
 * The selector also matches checkboxes in nested lists, but the item's own renders on its first
 * child paragraph, ahead of them in the DOM, which is why this takes `.first()`.
 */
export async function toggleTask(ctx: SimContext, listItemPath: number[]): Promise<void> {
	const pathAttr = JSON.stringify(listItemPath);
	const checkbox = ctx.page.locator(`[data-block-path='${pathAttr}'] .task-checkbox`).first();
	await actThenResync(ctx, () => checkbox.click());
}

/**
 * The one insert that starts from no block at all: a key at the edge of `boundaryIndex` puts
 * the caret in the gap between blocks, and the next key creates a paragraph there (empty `text`
 * means Enter). Both halves are checked, or a caret that went into the block instead would
 * record an ordinary edit as gap coverage. The new block leaves the caret mid-document, so this
 * is a note's last gesture. Arriving by 'arrow-up' serves containers with a title row, where
 * Backspace on the first child does nothing on purpose; the default covers Backspace at an edge.
 */
export async function mintAtGap(
	ctx: SimContext,
	boundaryIndex: number,
	text: string,
	options?: { arrival?: 'backspace' | 'arrow-up' }
): Promise<void> {
	await ctx.editor.clickBlockAtPath([boundaryIndex], 0);
	await ctx.page.keyboard.press(options?.arrival === 'arrow-up' ? 'ArrowUp' : 'Backspace');
	try {
		await ctx.editor.bridge.waitForGapCaret({ parentPath: [], index: boundaryIndex });
	} catch {
		throw new Error(
			`[${ctx.label}] mintAtGap: ${options?.arrival ?? 'backspace'} at block ${boundaryIndex} put` +
				` no gap caret there, got ` +
				`${JSON.stringify(await ctx.editor.bridge.getGapCaret())}; both neighbours must ` +
				`declare the facing edge, and the arrival must fit the block's surface.`
		);
	}
	await actThenResync(ctx, async () => {
		if (text) await ctx.editor.typeSlowly(text);
		else await ctx.page.keyboard.press('Enter');
		// Focusing the new block is what ends the gap; without it the keys still go to the
		// hidden host and the new bytes came from somewhere else.
		await ctx.editor.bridge.waitForGapCaret(null);
	});
}

async function actThenResync(ctx: SimContext, act: () => Promise<void>): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await act();
	await ctx.editor.bridge.waitForSourceWith((source, prev) => source !== prev, before);
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}
