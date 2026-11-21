/**
 * The selection as a plugin reads and sets it, in document bytes: a caret, a range, a block taken
 * whole, or table cells.
 */
import type { Block } from './doc-view';

/** The selection in document bytes: `anchor` where it started, `head` where it ends, `from` and
 *  `to` the same two in order. `block` is the deepest block holding the head; `cells` is set while
 *  table cells are selected. */
export interface Selection {
	readonly anchor: number;
	readonly head: number;
	readonly from: number;
	readonly to: number;
	readonly empty: boolean;
	readonly block: Block | null;
	readonly cells: {
		readonly table: Block;
		readonly anchor: readonly [number, number];
		readonly head: readonly [number, number];
	} | null;
}

/** What `select` takes: a caret's byte, a range, a block to take whole, or a table's cells by row
 *  and column. */
export type SelectionInput =
	| number
	| { anchor: number; head: number }
	| { block: Block }
	| { cells: Block; anchor: readonly [number, number]; head: readonly [number, number] };
