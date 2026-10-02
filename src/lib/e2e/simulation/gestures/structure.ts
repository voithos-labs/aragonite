import {
	type SimContext,
	actThenResync,
	assertFocusBlock,
	assertStructuralIntegrity,
	settleTypedSource
} from '../invariants';

/**
 * Structural gestures trigger the editor's own behaviour, so none can be predicted character by
 * character: each acts, waits for the source to change, then resyncs. In the wrong place a gesture
 * does nothing, so the wait times out and throws rather than recording a stale state.
 */

/**
 * Enter that changes the source without adding a top-level block (a code body, leaving a list),
 * so `pressEnter`'s block-count wait would hang; this waits for the source instead.
 */
export async function softEnter(ctx: SimContext): Promise<void> {
	await actThenResync(ctx, () => ctx.page.keyboard.press('Enter'));
}

/**
 * A fence typed at the document end completes itself and opens the language picker, which Enter
 * dismisses; the closing line is held past the caret, so the body is predicted in front of it.
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
 * The only gesture that writes a hard line break inside a paragraph, since Shift+Enter at a block's
 * end leaves a bare trailing backslash. It leaves the caret mid-block, so it is a note's last.
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
 * A move keeps the block count, so it waits for the source to change; a move at either end, which
 * does nothing, throws.
 */
export async function reorder(ctx: SimContext, blockIndex: number, dir: -1 | 1): Promise<void> {
	await ctx.editor.clickBlock(blockIndex);
	await ctx.editor.waitForRenderFlush();
	await actThenResync(ctx, () =>
		ctx.page.keyboard.press(dir < 0 ? 'Alt+ArrowUp' : 'Alt+ArrowDown')
	);
}

/**
 * The edge of an opaque container refuses the move, so a block that jumped out would change the
 * source and throw. `bodyPath` is a body block, never the title row, which binds no Alt+Arrow.
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
 * An empty item's marker is trimmed at every depth, so the source does not change: this waits on
 * the focused item's path growing, and `typeFreshItem` resyncs when the marker comes back.
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
 * Waits like `indentEmptyItem`: `outdent`'s source wait would hang, since an empty item's trimmed
 * marker changes nothing unless the outdent leaves the list.
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
 * The first body character brings back the trimmed marker, so it waits and resyncs; the rest is
 * predicted as usual, at any depth, with no typos injected.
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
 * The editor adds a space once the body starts, so `>text` lands as `> text`; this waits for the
 * body and resyncs. Fixtures pass `text` without a leading space.
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
 * Enter inside a quote adds a line, not a top-level block, and the editor writes the `> ` itself,
 * so this waits for the whole line. Fixtures pass `text` without a leading `>` or space.
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
 * The editor adds both spaces as the body arrives, so this types `>` and the bare body and waits
 * for the whole line, like `startQuote`.
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
 * The keyboard way to the same toggle: a click puts the caret in the item's paragraph, checked
 * before the chord, so a landing in another item never records as this one's toggle.
 */
export async function toggleTaskByKeyboard(
	ctx: SimContext,
	itemParagraphPath: number[]
): Promise<void> {
	await ctx.editor.clickBlockAtPath(itemParagraphPath, 1);
	await assertFocusBlock(ctx, itemParagraphPath);
	await actThenResync(ctx, () => ctx.page.keyboard.press('ControlOrMeta+Enter'));
}

/**
 * `# ` typed at the start of a list item's paragraph makes it a heading, so the space changes the
 * block's kind; one undo must bring back the bytes from before the `#`.
 */
export async function kindChangeUndoInListItem(
	ctx: SimContext,
	itemParagraphPath: number[]
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	// A fresh typing batch, so the one undo covers exactly the two keys below.
	await editor.waitForUndoBatchFlush();
	await editor.clickBlockAtPath(itemParagraphPath, 0);
	await assertFocusBlock(ctx, itemParagraphPath);
	await page.keyboard.press('Home');
	// One call, so no round trip between the keys can outlast the typing pause and split the batch.
	await editor.typeSlowly('# ');
	await page
		.waitForFunction(
			(path) => {
				let node = (window as any).__test.getDocument();
				for (const i of path) node = node?.children?.[i];
				return node?.kind === 'heading';
			},
			itemParagraphPath,
			{ timeout: 5000, polling: 16 }
		)
		.catch(async () => {
			throw new Error(
				`[${ctx.label}] kindChangeUndoInListItem: \`# \` at the start of ` +
					`${JSON.stringify(itemParagraphPath)} made no heading.\n` +
					`SOURCE: ${JSON.stringify(await editor.bridge.getSource())}`
			);
		});
	await assertStructuralIntegrity(ctx);
	await editor.undo();
	await editor.bridge.waitForSourceEquals(before, 3000).catch(async () => {
		throw new Error(
			`[${ctx.label}] one undo after a kind change inside a list item did not restore the ` +
				`bytes from before the burst.\nBEFORE: ${JSON.stringify(before)}\n` +
				`GOT:    ${JSON.stringify(await editor.bridge.getSource())}`
		);
	});
	tracker.resync(before);
}

/**
 * A key at the edge of `boundaryIndex` puts the caret in the gap and the next creates a paragraph
 * there (empty `text` means Enter); both are checked. `'arrow-up'` serves title-row containers.
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
