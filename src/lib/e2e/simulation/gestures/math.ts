import type { Page } from '@playwright/test';
import type { Gestures } from '../gestures';
import { type SimContext } from '../invariants';

// Math gestures for the LaTeX extension (plugins route only). Each gates on an observable
// widget/render swap and RESYNCS around the reparse — never predicts across a mount
// boundary, where a promotion or a `$…$`→widget swap would desync a char count.

const INLINE_WIDGET = '.math-inline-widget';
const BLOCK_RENDER = '.math-block-render';
const BLOCK_SOURCE = '.math-block-source';

async function waitForWidgetCount(page: Page, expected: number, timeout = 2000): Promise<void> {
	await page.waitForFunction(
		(n) => document.querySelectorAll('.math-inline-widget').length === n,
		expected,
		{ timeout, polling: 16 }
	);
}

/**
 * Walking the caret out is what commits a reveal. Enter is the block's split key, not a
 * commit gesture (see `latex-inline-reveal-commands`), so every reveal→edit gesture escapes.
 */
async function escapeRevealToCommit(ctx: SimContext, before: string): Promise<void> {
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

// A plain `.click()` lands at the first content quad's center, which the clipped 1px
// `.katex-mathml` half degenerates to a corner OUTSIDE the island — silently missing the
// reveal hit-test. Aim at the painted `.katex-html` glyphs instead.
export async function clickInlineWidget(page: Page, nth: number): Promise<void> {
	const widget = page.locator(INLINE_WIDGET).nth(nth);
	const glyphs = widget.locator('.katex-html');
	const target = (await glyphs.count()) > 0 ? glyphs.first() : widget;
	const box = await target.boundingBox();
	if (!box) throw new Error('inline math widget has no bounding box');
	await target.click({ position: { x: box.width / 2, y: box.height / 2 } });
}

/**
 * Inline recognition is render-time, so the widget appears once the closing `$` lands and
 * the caret stays in the host paragraph. Resyncs around the recompute.
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
 * Promotion focuses the new block, which REVEALS its source, so this blurs onto
 * `blurBlockIndex` to fold it back — the render-primary state a following gesture expects.
 */
export async function insertBlockMath(
	ctx: SimContext,
	formula: string,
	blurBlockIndex: number
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const rendersBefore = await page.locator(BLOCK_RENDER).count();

	await editor.typeSlowly(`$$${formula}$$`);
	await editor.bridge.waitForSourceContains(`$$${formula}$$`);
	await editor.clickBlock(blurBlockIndex);
	await page.locator(BLOCK_RENDER).nth(rendersBefore).waitFor({ state: 'visible' });
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/** The click→reveal→commit path; gates on the widget folding back to a render. */
export async function editInlineMath(ctx: SimContext, text: string): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const widgetCount = await page.locator(INLINE_WIDGET).count();

	await clickInlineWidget(page, 0);
	await waitForWidgetCount(page, widgetCount - 1); // the clicked island folded to source
	await editor.waitForRenderFlush();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.type(text);
	await escapeRevealToCommit(ctx, before);

	await waitForWidgetCount(page, widgetCount); // commit re-rendered the island
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Block math commits on BLUR as one undo entry, so `blurBlockIndex` must be a real sibling.
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
 * A net-identity edit of the text flanking a SURVIVING widget: drives the widget-aware
 * read-back over the nonzero-interior byte-survival class (G1.9). The caller asserts the
 * widget count held.
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
 * Shift+ArrowLeft selects the widget atomically, then Backspace removes it. A caret-adjacent
 * Backspace cannot reach this: on a reveal-capable kind it opens the reveal, whose edits stay
 * ephemeral, so that path never changes `getSource()`.
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
 * The caret-entry reveal's byte-survival class: ArrowLeft across the trailing edge opens the
 * reveal, and stepping out its leading edge folds it back unedited, so the round trip must be
 * byte-identical. Steps until the island returns (the source length is unknown here), capped
 * so an over-press cannot walk far past the widget's left runway.
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
	// The escape fold survives a tick, so settle on the island's RETURN rather than race it.
	await waitForWidgetCount(page, widgetCount);
	await editor.bridge.waitForSourceEquals(before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * The caret-entry reveal's commit-on-ESCAPE path, distinct from the click→blur commit
 * `editInlineMath` covers. Backspace at the trailing edge opens the reveal rather than
 * deleting the widget; the edit is EPHEMERAL DOM until commit, which is asserted by
 * `getSource()` holding unchanged while the source is shown. Resyncs around the reparse.
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
	await page.keyboard.type(insert);
	// The reveal suppresses the per-keystroke CST commit, so a settle-then-compare here proves
	// the insert never leaked into the source.
	await editor.waitForNoSourceMutation();
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
// Both gestures drive the fence from a FLANKING prose block and never focus it: the render
// reveals its source on pointerdown, so a click would drive the reveal, not the block. Under
// test is the fence's raw surviving two structural moves that never enter it.

// Both range endpoints sit this far into their flanking prose block, so the range
// covers real content on each side rather than only the block boundaries.
const FLANK_OFFSET = 2;

function trimTrailingNewlines(raw: string): string {
	return raw.replace(/\n+$/, '');
}

/**
 * A net-identity sibling permutation. Mid-move the fence's raw AND kind are checked, so a
 * permutation that rebuilt it as plain `fencedCode`, or dropped a byte of its info string,
 * fails loud. The closing move settles on byte-identical return, so a no-op second press
 * times out instead of passing.
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
 * A range with the fence wholly INTERIOR: neither endpoint lands on the render, so nothing
 * reveals and the destroy runs over an opaque render-primary block. Both flanking blocks must
 * be plain prose so the survivor is byte-predictable — comparing against it catches a fence
 * FRAGMENT (a stray backtick, half an info string), which is the corruption shape worth
 * catching since it reparses as a different kind and a whole-line check would miss it.
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

	// Fenced on both sides so the collapse is its OWN undo entry: without the leading pause it
	// coalesces with the caller's prior work and the single undo unwinds more than the delete.
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
