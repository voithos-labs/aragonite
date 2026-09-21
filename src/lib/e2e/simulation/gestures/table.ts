import { type SimContext } from '../invariants';

// Table gestures. They resync rather than predict: building a table pads every cell to a
// standard width, and an edit to a cell lands between pipes in the middle of the source, so
// neither is the append at the end that the expected answer predicts.
//
// A table renders as an interactive `.table-block` only once a document is loaded: typed pipe
// syntax stays a paragraph and never grows a `[role="cell"]`, so a session must start from one.

const CELL = '[role="cell"]';

/** Click the cell at `cellIndex`, counted across the rendered grid row by row. */
async function clickCell(ctx: SimContext, cellIndex: number): Promise<void> {
	await ctx.page.locator(CELL).nth(cellIndex).click();
}

/**
 * The edit lands between pipes, so it cannot be predicted as text added at the end of the
 * document. Presses End first, so the text goes after the cell's content instead of splitting it.
 */
export async function editCell(ctx: SimContext, cellIndex: number, text: string): Promise<void> {
	await clickCell(ctx, cellIndex);
	await ctx.page.keyboard.press('End');
	await actThenResync(ctx, () => ctx.page.keyboard.type(text));
}

/**
 * Touches every row, which is the hardest test of per-row state the table offers, so the checks
 * see a keyed container change across all rows at once.
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
 * Waiting for the source to differ works for any of these and needs no worked-out target. A
 * delete that does nothing (the table is already one row or one column) leaves the source
 * unchanged, so the wait times out and the gesture throws instead of recording a stale state.
 */
async function actThenResync(ctx: SimContext, act: () => Promise<void>): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await act();
	await ctx.editor.bridge.waitForSourceWith((source, prev) => source !== prev, before);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}
