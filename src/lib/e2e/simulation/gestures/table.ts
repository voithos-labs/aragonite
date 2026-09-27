import { type SimContext, actThenResync } from '../invariants';

// Table gestures resync rather than predict: building a table pads every cell, and a cell edit
// lands mid-source, neither being the append the expected answer predicts. Typed pipe syntax stays
// a paragraph, so a session must start from a loaded document with a table.

const CELL = '.table-cell';

/** Click the cell at `cellIndex`, counted across the rendered grid row by row. */
async function clickCell(ctx: SimContext, cellIndex: number): Promise<void> {
	await ctx.page.locator(CELL).nth(cellIndex).click();
}

/**
 * End first, so the text goes after the cell's content instead of splitting it.
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
