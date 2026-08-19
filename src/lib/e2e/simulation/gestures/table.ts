import { type SimContext } from '../invariants';

// Table gestures. RESYNC rather than predict: table construction auto-pads every cell to
// canonical padding and a typed cell edit lands mid-source between pipes, so neither is the
// end-of-document append the tracker predicts.
//
// A live table renders an interactive `.table-block` only after a LOAD — typed pipe syntax
// stays a paragraph and never exposes `[role="cell"]` — so sessions must start from one.

const CELL = '[role="cell"]';

/** Click the cell at `cellIndex` (row-major over the rendered grid). */
async function clickCell(ctx: SimContext, cellIndex: number): Promise<void> {
	await ctx.page.locator(CELL).nth(cellIndex).click();
}

/**
 * The edit lands between pipes, so it cannot be predicted as an end-of-document append.
 * Presses End first so the text appends to existing cell content rather than splitting it.
 */
export async function editCell(ctx: SimContext, cellIndex: number, text: string): Promise<void> {
	await clickCell(ctx, cellIndex);
	await ctx.page.keyboard.press('End');
	await actThenResync(ctx, () => ctx.page.keyboard.type(text));
}

/**
 * Touches EVERY row — the richest stale-`$state` / per-row-scope stress the table offers — so
 * the oracles see a keyed-container move across all rows at once.
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
	await actThenResync(ctx, () => ctx.page.keyboard.press('ControlOrMeta+Enter'));
}

/** Delete the body row holding the cell at `cellIndex` (Ctrl+Shift+Backspace). */
export async function deleteRow(ctx: SimContext, cellIndex: number): Promise<void> {
	await clickCell(ctx, cellIndex);
	await actThenResync(ctx, () => ctx.page.keyboard.press('ControlOrMeta+Shift+Backspace'));
}

/**
 * The "source differs" predicate is op-agnostic and needs no computed target. A no-op (delete
 * at the 1-row/1-column floor) leaves the source unchanged, so the settle times out and the
 * gesture fails loudly rather than recording a stale state as truth.
 */
async function actThenResync(ctx: SimContext, act: () => Promise<void>): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await act();
	await ctx.editor.bridge.waitForSourceWith((source, prev) => source !== prev, before);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}
