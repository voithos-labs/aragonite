import type { Page } from '@playwright/test';
import type { Gestures } from '../gestures';
import { type SimContext } from '../invariants';

// Math gestures for the LaTeX extension (plugins route only). Free functions
// taking `ctx` first so the Gestures class delegates without growing its frozen
// surface, mirroring gestures/image.ts. Each drives real keyboard/mouse, gates on
// an observable widget/render swap, then resyncs the tracker around the reparse or
// promotion the editor performs — never predicts across a mount boundary, where a
// paragraph→mathBlock promotion or a `$…$`→widget swap would desync a char count.

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

async function blockRaw(ctx: SimContext, index: number): Promise<string> {
	return ctx.page.evaluate(
		(i) => ((window as any).__test.getDocument().children[i]?.raw ?? '') as string,
		index
	);
}

// A plain `.click()` on a rendered KaTeX island lands at the first content quad's
// center; with katex.css loaded the clipped 1px `.katex-mathml` half degenerates
// that point to a corner outside the island and silently misses the reveal
// hit-test — the same trap the plugin e2e's `clickWidgetCenter` documents. Aim at
// the painted `.katex-html` glyphs, falling back to the island's own box.
async function clickInlineWidget(page: Page, nth: number): Promise<void> {
	const widget = page.locator(INLINE_WIDGET).nth(nth);
	const glyphs = widget.locator('.katex-html');
	const target = (await glyphs.count()) > 0 ? glyphs.first() : widget;
	const box = await target.boundingBox();
	if (!box) throw new Error('inline math widget has no bounding box');
	await target.click({ position: { x: box.width / 2, y: box.height / 2 } });
}

/**
 * Type `$formula$` at the caret (a prose block), then gate on the newly mounted
 * inline widget. Inline recognition is render-time, so the widget appears once the
 * closing `$` lands; the caret stays in the host paragraph, so a caller may keep
 * editing after. Resyncs around the recompute rather than predicting per char.
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
 * Type `$$formula$$` on an empty line at column 0, promoting the paragraph to a
 * math block. Promotion focuses the new block, which reveals its source, so the
 * gesture blurs onto `blurBlockIndex` to fold it to the rendered display — leaving
 * the block in the render-primary state a following reveal/edit gesture expects.
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

/**
 * Click the first inline widget to reveal its `$…$` source, step past the opening
 * `$`, insert `text`, and commit with Enter — the select→reveal→commit UX. Gates
 * on the widget folding back to a render after commit.
 */
export async function editInlineMath(ctx: SimContext, text: string): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await editor.bridge.getSource();
	const widgetCount = await page.locator(INLINE_WIDGET).count();

	await clickInlineWidget(page, 0);
	await waitForWidgetCount(page, widgetCount - 1); // the clicked island folded to source
	await editor.waitForRenderFlush();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.type(text);
	await page.keyboard.press('Enter');

	await waitForWidgetCount(page, widgetCount); // commit re-rendered the island
	await editor.bridge.waitForSourceWith((s, prev) => s !== prev, before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Click the first block render to reveal its source, step inside the `$$` fence,
 * insert `text`, and commit by blurring onto `blurBlockIndex`. Block math commits
 * on blur (one undo entry), so the blur target must be a real sibling block.
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
 * Type a char immediately after the inline widget in block `blockIndex`, then
 * delete it — a net-identity edit of the text node flanking a *surviving* widget.
 * This drives the widget-aware read-back over a block whose text changes while the
 * widget stays (the nonzero-interior byte-survival class, G1.9); the widget is left
 * in place for a following delete-of. The caller asserts the widget count held.
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
 * Delete the inline widget that ends block `blockIndex` atomically: Shift+ArrowLeft
 * from the block end selects the widget as one unit (atomic selection extension),
 * Backspace removes its bytes. Caret-adjacent Backspace no longer reaches this —
 * for a reveal-capable kind it opens the source reveal, whose edits stay ephemeral
 * until commit, so a backspace-backspace path never changes `getSource()`.
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
 * Walk the caret through a block-final inline widget and back out, asserting the
 * entry-reveal + escape-fold nets to identity (the caret-entry reveal's
 * byte-survival class). From the block end — right of the widget — one ArrowLeft
 * crosses the trailing edge and opens the source reveal: the rendered island swaps
 * for editable `$…$` text, so the widget count drops. Further ArrowLefts step
 * through the source and out its leading edge, where the escape folds the reveal
 * back to the rendered island (unedited → restored verbatim, CST untouched). Steps
 * until the island returns — the source length is unknown here — capped tight so an
 * over-press cannot walk far past the widget's left runway. An unedited entry+fold
 * changes no bytes, so `getSource()` is byte-identical after.
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
	// The escape fold survives a tick, so settle on the island's return rather than
	// racing it — then confirm the round trip left the source byte-identical.
	await waitForWidgetCount(page, widgetCount);
	await editor.bridge.waitForSourceEquals(before);
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Enter a block-final inline widget with Backspace, insert a char inside the
 * formula, and commit by walking the caret out the trailing edge — the caret-entry
 * reveal's commit-on-escape path (distinct from the click→Enter/blur commit
 * `editInlineMath`/`editBlockMath` already cover). Backspace from the
 * trailing edge opens the reveal (it never deletes a reveal-capable widget); one
 * ArrowLeft steps inside the closing `$` so the insert stays within the fence; the
 * edit is EPHEMERAL DOM until commit, asserted by `getSource()` holding unchanged
 * while the source is shown; ArrowRight past the trailing edge escapes and commits
 * the edit as one undo entry, re-rendering the island. Resyncs around the reparse.
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
	// The reveal suppresses the per-keystroke CST commit, so the insert is DOM-only
	// until escape — a settle-then-compare proves it never leaked into the source.
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
// GitHub's third math form: a ```math fence is its own `mathFence` kind riding the
// same render-primary component as `$$…$$`. Both gestures drive it from a FLANKING
// prose block and never focus the fence itself: the render reveals its source on
// pointerdown, so a gesture that clicked it would be driving the reveal rather than
// the block. What is under test here is the fence's raw bytes surviving the two
// structural moves that reach an opaque leaf without entering it.

// Both range endpoints sit this far into their flanking prose block, so the range
// covers real content on each side rather than only the block boundaries.
const FLANK_OFFSET = 2;

function trimTrailingNewlines(raw: string): string {
	return raw.replace(/\n+$/, '');
}

/**
 * Alt+ArrowDown the prose block at `proseIndex` past the fence directly below it, then
 * Alt+ArrowUp straight back — a net-identity permutation of the sibling array. The
 * reorder keeps the moved block focused, so the return press needs no re-click. After
 * the down move the fence sits at `proseIndex`, where its raw and kind must be exactly
 * what they were: a permutation that rebuilt it as a plain `fencedCode`, or dropped a
 * byte of its info string or body, fails loud rather than being recorded as truth. The
 * closing move settles on the source returning byte-identical, so a no-op second press
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
 * Shift+Click a cross-block range from mid-prose ABOVE the fence to mid-prose BELOW it,
 * so the fence is wholly INTERIOR to the range, then Backspace it away. Neither endpoint
 * lands on the render, so nothing reveals and the destroy runs over an opaque
 * render-primary block for the first time. Both flanking blocks must be plain prose, so
 * their raw-semantic caret offsets are plain character offsets and the surviving block is
 * predictable: the head of the block above joined to the tail of the block below, exact to
 * the byte. Comparing against that catches a fence FRAGMENT — a stray backtick, half an
 * info string, a clipped formula — which a check for whole surviving fence lines would let
 * through, and that fragment is the corruption shape worth catching, since it reparses as
 * a different kind. One undo then restores the document byte-exactly with the render
 * remounted, proving the delete was a single reversible entry.
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

	// Fence the batch on both sides so the collapse is its own undo entry: without the
	// leading pause it could coalesce with whatever the caller did before it, and the
	// closing single undo would then unwind more than the delete.
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
