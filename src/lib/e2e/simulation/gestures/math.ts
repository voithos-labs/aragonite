import type { Page } from '@playwright/test';
import type { Gestures } from '../gestures';
import { type SimContext } from '../invariants';

// Math gestures for the LaTeX extension (plugins route only). Each waits for the widget to swap
// in or out and resyncs, since predicting across a change of kind, or across `$…$` turning into a
// widget, would miscount.

const INLINE_WIDGET = '.math-inline-widget';
const BLOCK_RENDER = '.math-block-render';
const BLOCK_SOURCE = '.math-block-source';

async function waitForWidgetCount(page: Page, expected: number, timeout = 5000): Promise<void> {
	await page.waitForFunction(
		(n) => document.querySelectorAll('.math-inline-widget').length === n,
		expected,
		{ timeout, polling: 16 }
	);
}

/**
 * Walking the caret out commits an open formula; Enter splits the block instead
 * (`latex-inline-reveal-commands`), so every edit here leaves by the caret.
 */
export async function escapeRevealToCommit(ctx: SimContext, before: string): Promise<void> {
	for (let i = 0; i < 40; i++) {
		await ctx.page.keyboard.press('ArrowRight');
		if ((await ctx.editor.bridge.getSource()) !== before) return;
	}
	throw new Error(`[${ctx.label}] the revealed source never committed on a caret escape`);
}

async function blockRaw(ctx: SimContext, index: number): Promise<string> {
	return ctx.page.evaluate(
		(i) => ((window as any).__test.getDocument().children[i]?.raw ?? '') as string,
		index
	);
}

// A plain `.click()` aims at the first box's centre, which for the clipped 1px `.katex-mathml`
// half misses the widget, so this aims `xFraction` across the visible `.katex-html` characters.
export async function clickInlineWidget(page: Page, nth: number, xFraction = 0.5): Promise<void> {
	const widget = page.locator(INLINE_WIDGET).nth(nth);
	const glyphs = widget.locator('.katex-html');
	const target = (await glyphs.count()) > 0 ? glyphs.first() : widget;
	const box = await target.boundingBox();
	if (!box) throw new Error('inline math widget has no bounding box');
	const x = Math.min(box.width * xFraction, box.width - 1);
	await target.click({ position: { x, y: box.height / 2 } });
}

/**
 * Inline math is recognised when rendering, so the widget appears once the closing `$` is
 * typed and the caret stays in the paragraph. Resyncs once the block has been rebuilt.
 */
export async function insertInlineMath(ctx: SimContext, formula: string): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const widgetsBefore = await page.locator(INLINE_WIDGET).count();

	await editor.typeSlowly(`$${formula}$`);
	await page.locator(INLINE_WIDGET).nth(widgetsBefore).waitFor({ state: 'visible' });
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Becoming a math block focuses it, which shows its source, so this clicks away onto
 * `blurBlockIndex` to close it again and leave it rendered, as the next gesture expects.
 */
export async function insertBlockMath(
	ctx: SimContext,
	formula: string,
	blurBlockIndex: number
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const rendersBefore = await page.locator(BLOCK_RENDER).count();

	// `$$` completes to a block that holds the formula in its editor until the blur commits it.
	await editor.typeSlowly('$$');
	await editor.bridge.waitForSourceContains('$$\n\n$$');
	await page.keyboard.type(formula);
	await editor.clickBlock(blurBlockIndex);
	await editor.bridge.waitForSourceContains(`$$\n${formula}\n$$`);
	await page.locator(BLOCK_RENDER).nth(rendersBefore).waitFor({ state: 'visible' });
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/** Click to open, edit, commit; waits for the widget to close back to its rendered form. */
export async function editInlineMath(ctx: SimContext, text: string): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const widgetCount = await page.locator(INLINE_WIDGET).count();

	// At the end of the formula the caret sits inside the closing `$`, so the typed byte lands last.
	await clickInlineWidget(page, 0, 1);
	await waitForWidgetCount(page, widgetCount - 1); // the clicked widget opened to its source
	await editor.waitForRenderFlush();
	await page.keyboard.type(text);
	await escapeRevealToCommit(ctx, before);

	await waitForWidgetCount(page, widgetCount); // the commit rendered the widget again
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Block math commits on blur, as one undo entry, so `blurBlockIndex` must be a real block.
 */
export async function editBlockMath(
	ctx: SimContext,
	text: string,
	blurBlockIndex: number
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();

	await page.locator(BLOCK_RENDER).first().click();
	await page.locator(BLOCK_SOURCE).first().waitFor({ state: 'visible' });
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.type(text);
	await editor.clickBlock(blurBlockIndex);

	await page.locator(BLOCK_RENDER).first().waitFor({ state: 'visible' });
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Edits the text on either side of a widget and restores it, driving the read-back that accounts
 * for the widget's hidden bytes (G1.9); the caller checks the widget count held.
 */
export async function deleteAroundInlineMath(ctx: SimContext, blockIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();

	await editor.focusBlockEnd(blockIndex);
	await page.keyboard.type('Q');
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceEquals(before);

	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Backspace beside a widget opens the formula instead, and an open formula keeps its edits out of
 * the tree, so Shift+ArrowLeft selects the whole widget first.
 */
export async function deleteInlineMathWidget(ctx: SimContext, blockIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();

	await editor.focusBlockEnd(blockIndex);
	await page.keyboard.press('Shift+ArrowLeft');
	await page.keyboard.press('Backspace');

	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * ArrowLeft across the end opens the formula and stepping out of the front closes it unedited,
 * so the round trip must be identical; the step count is capped so it cannot walk far past.
 */
export async function walkThroughInlineMath(ctx: SimContext, blockIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const widgetCount = await page.locator(INLINE_WIDGET).count();

	await editor.focusBlockEnd(blockIndex);
	await page.keyboard.press('ArrowLeft');
	await waitForWidgetCount(page, widgetCount - 1);

	for (let i = 0; i < 12 && (await page.locator(INLINE_WIDGET).count()) < widgetCount; i++) {
		await page.keyboard.press('ArrowLeft');
	}
	// Closing the formula takes a tick, so wait for the widget to come back rather than race it.
	await waitForWidgetCount(page, widgetCount);
	await editor.bridge.waitForSourceEquals(before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Enters with the caret and commits by stepping out, unlike `editInlineMath`'s click and blur;
 * the edit lives in the DOM alone until the commit, so `getSource()` must hold while it is open.
 */
export async function backspaceRevealEditInlineMath(
	ctx: SimContext,
	blockIndex: number,
	insert: string
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const widgetCount = await page.locator(INLINE_WIDGET).count();

	await editor.focusBlockEnd(blockIndex);
	await page.keyboard.press('Backspace');
	await waitForWidgetCount(page, widgetCount - 1);

	await page.keyboard.press('ArrowLeft');
	// An open formula holds its keystrokes out of the tree, so the editor's recorded decision
	// about each key is what orders the byte check proving nothing leaked into the source.
	await editor.typeDeclined(insert);
	if ((await editor.bridge.getSource()) !== before) {
		throw new Error(
			`[${ctx.label}] reveal edit committed before escape.\n` +
				`EXPECTED (ephemeral): ${JSON.stringify(before)}\n` +
				`ACTUAL:               ${JSON.stringify(await editor.bridge.getSource())}`
		);
	}

	for (let i = 0; i < 4 && (await page.locator(INLINE_WIDGET).count()) < widgetCount; i++) {
		await page.keyboard.press('ArrowRight');
	}
	await waitForWidgetCount(page, widgetCount);
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

// ── Math fence ──────────────────────────────────────────────────────────────
// Both gestures work from a prose block beside the fence and never focus it, since the fence shows
// its source on pointerdown; the fence's raw text must survive two moves that never enter it.

// Both ends of the range sit this far into the prose blocks beside the fence, so the range
// covers real content on each side rather than only the block edges.
const FLANK_OFFSET = 2;

function trimTrailingNewlines(raw: string): string {
	return raw.replace(/\n+$/, '');
}

/**
 * Halfway through the swap, the fence's raw text and kind are checked, so a move that rebuilt it
 * as plain `fencedCode` throws; a move back that did nothing times out instead of passing.
 */
export async function reorderPastMathFence(
	ctx: SimContext,
	proseIndex: number,
	fenceIndex: number
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const fenceRaw = await blockRaw(ctx, fenceIndex);
	const rendersBefore = await page.locator(BLOCK_RENDER).count();

	await editor.clickBlock(proseIndex);
	await editor.waitForRenderFlush();
	await page.keyboard.press('Alt+ArrowDown');
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);

	const movedRaw = await blockRaw(ctx, proseIndex);
	const movedKind = await editor.bridge.getBlockKind(proseIndex);
	if (movedRaw !== fenceRaw || movedKind !== 'mathFence') {
		throw new Error(
			`[${ctx.label}] the sibling reorder corrupted the math fence it moved past.\n` +
				`EXPECTED: mathFence ${JSON.stringify(fenceRaw)}\n` +
				`ACTUAL:   ${movedKind} ${JSON.stringify(movedRaw)}`
		);
	}
	await page
		.locator(BLOCK_RENDER)
		.nth(rendersBefore - 1)
		.waitFor({ state: 'visible' });

	await page.keyboard.press('Alt+ArrowUp');
	await editor.bridge.waitForSourceEquals(before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Neither end of the range lands on the fence, so the delete runs over a rendered block; the plain
 * prose on both sides makes the leftover predictable byte for byte, catching a stray fence piece.
 */
export async function deleteAcrossMathFence(
	ctx: SimContext,
	g: Gestures,
	fenceIndex: number
): Promise<void> {
	const { page, editor, tracker } = ctx;
	if (fenceIndex < 1) {
		throw new Error(`[${ctx.label}] deleteAcrossMathFence needs a prose block above the fence`);
	}
	const before = await editor.bridge.getSource();
	const rendersBefore = await page.locator(BLOCK_RENDER).count();
	const survivor =
		trimTrailingNewlines(await blockRaw(ctx, fenceIndex - 1)).slice(0, FLANK_OFFSET) +
		trimTrailingNewlines(await blockRaw(ctx, fenceIndex + 1)).slice(FLANK_OFFSET);

	// Separated on both sides so the delete gets its own undo entry: without the pause before it,
	// it joins the caller's earlier work and one undo reverses more than the delete.
	await g.pause();
	await editor.focusBlockAtPath([fenceIndex - 1], FLANK_OFFSET);
	await g.shiftClickAcross([fenceIndex + 1], FLANK_OFFSET);
	await g.deleteSelection('Backspace');

	const collapsed = trimTrailingNewlines(await blockRaw(ctx, fenceIndex - 1));
	if (collapsed !== survivor) {
		throw new Error(
			`[${ctx.label}] the cross-block delete did not remove the math fence cleanly.\n` +
				`EXPECTED: ${JSON.stringify(survivor)}\n` +
				`ACTUAL:   ${JSON.stringify(collapsed)}\n` +
				`SOURCE:   ${JSON.stringify(await editor.bridge.getSource())}`
		);
	}

	await g.pause();
	await g.undo();
	await editor.bridge.waitForSourceEquals(before, 3000);
	await page
		.locator(BLOCK_RENDER)
		.nth(rendersBefore - 1)
		.waitFor({ state: 'visible' });
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}
