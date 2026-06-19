import { type SimContext } from '../invariants';

// Table gestures. Free functions taking `ctx` first so the Gestures class can
// delegate to them without growing its frozen surface. Each performs a real
// cell click plus the table's documented keyboard op, settles on the source
// changing from its pre-gesture snapshot, then resyncs the tracker to the
// observed result.
//
// Why resync instead of predict: table construction auto-pads every cell to
// canonical single-space padding (`| a |`, empty cells `|  |`), and a typed
// cell edit lands mid-source between pipes — neither is the end-of-document
// append the ExpectationTracker predicts. So like image.ts these gestures
// adopt the observed source rather than computing a target.
//
// A live table renders an interactive `.table-block` only after the document
// is parsed by load (typed pipe syntax stays a paragraph in the live tree, so
// it never exposes `[role="cell"]`). Sessions that drive these gestures must
// therefore start from a loaded table.

const CELL = '[role="cell"]';

/** Click the cell at `cellIndex` (row-major over the rendered grid). */
async function clickCell(ctx: SimContext, cellIndex: number): Promise<void> {
	await ctx.page.locator(CELL).nth(cellIndex).click();
}

/**
 * Type `text` into the cell at `cellIndex`. The edit lands between pipes, so it
 * can't be predicted as an end-of-document append — settle on the source delta
 * and resync. Clicks the cell, presses End so the text appends to existing cell
 * content rather than splitting it, types, then resyncs.
 */
export async function editCell(ctx: SimContext, cellIndex: number, text: string): Promise<void> {
	await clickCell(ctx, cellIndex);
	await ctx.page.keyboard.press('End');
	await actThenResync(ctx, () => ctx.page.keyboard.type(text));
}

/**
 * Insert a column to the right of the cell at `cellIndex` (Alt+Shift+ArrowRight).
 * Touches every row — the richest stale-`$state`/per-row-scope stress the table
 * offers — so the round-trip + nested-state oracle sees a keyed-container move
 * across all rows at once.
 */
export async function insertColumnRight(ctx: SimContext, cellIndex: number): Promise<void> {
	await clickCell(ctx, cellIndex);
	await actThenResync(ctx, () => ctx.page.keyboard.press('Alt+Shift+ArrowRight'));
}

/** Delete the column containing the cell at `cellIndex` (Alt+Shift+Backspace). */
export async function deleteColumn(ctx: SimContext, cellIndex: number): Promise<void> {
	await clickCell(ctx, cellIndex);
	await actThenResync(ctx, () => ctx.page.keyboard.press('Alt+Shift+Backspace'));
}

/** Insert a row below the row holding the cell at `cellIndex` (Ctrl+Enter). */
export async function insertRowBelow(ctx: SimContext, cellIndex: number): Promise<void> {
	await clickCell(ctx, cellIndex);
	await actThenResync(ctx, () => ctx.page.keyboard.press('Control+Enter'));
}

/** Delete the body row holding the cell at `cellIndex` (Ctrl+Shift+Backspace). */
export async function deleteRow(ctx: SimContext, cellIndex: number): Promise<void> {
	await clickCell(ctx, cellIndex);
	await actThenResync(ctx, () => ctx.page.keyboard.press('Control+Shift+Backspace'));
}

/**
 * Run a table op, wait for the source to change from its pre-op snapshot, then
 * adopt the observed source. The "source differs" predicate is op-agnostic
 * (insert grows the source, delete shrinks it, a cell edit rewrites it) and
 * needs no computed target. A no-op op (delete at the 1-row/1-column floor)
 * leaves the source unchanged, so the settle times out and the gesture fails
 * loudly rather than recording a stale state as truth.
 */
async function actThenResync(ctx: SimContext, act: () => Promise<void>): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await act();
	await ctx.editor.bridge.waitForSourceWith((source, prev) => source !== prev, before);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}
