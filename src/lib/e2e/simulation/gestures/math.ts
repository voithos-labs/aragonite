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

	await page.locator(INLINE_WIDGET).first().click();
	await editor.waitForRenderFlush();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.type(text);
	await page.keyboard.press('Enter');

	await page.locator(INLINE_WIDGET).first().waitFor({ state: 'visible' });
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
