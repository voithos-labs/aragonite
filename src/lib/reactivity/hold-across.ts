/**
 * Which block stays still across a measure round, picked level by level down the document's
 * block lists before the round, and where it is once the round's changes have landed. See
 * `docs/design/virtual-rendering.md` § Keeping the page still while heights change.
 */
import type { HeightModel } from '../cursor/height-model';
import { recordNeighbourPass } from '../perf/instruments';

/** A list's block heights, with the ids they were built from lined up by index. */
export interface HeightTable {
	readonly model: HeightModel;
	/** A snapshot, so a round finds its held block by id in the order from before a change. */
	readonly ids: readonly string[];
}

declare const picked: unique symbol;
declare const measured: unique symbol;

/** The block a list keeps still, with its index in the table it was picked from. Only
 *  `heldBlock` makes one. */
export type HeldBlock = {
	readonly id: string;
	readonly index: number;
	/** Picked because the caret is in it, which a change that moves it cancels. */
	readonly focused: boolean;
	readonly [picked]: true;
};

/** How far the held block's top moved across a round. Only `heldDelta` makes one, so a
 *  correction can't use a distance worked out some other way. */
export type HeldDelta = number & { readonly [measured]: true };

/** The focused block's index among the children of the list at `listPath`, or null when the
 *  focus path doesn't run through that list. */
export function focusedIndexIn(
	focusPath: readonly number[] | null,
	listPath: readonly number[]
): number | null {
	if (!focusPath || focusPath.length <= listPath.length) return null;
	for (let i = 0; i < listPath.length; i++) if (focusPath[i] !== listPath[i]) return null;
	return focusPath[listPath.length];
}

/** The focused block when it sits at or below `localTop`, else the block at the top, else none. */
export function heldBlock(
	table: HeightTable,
	localTop: number,
	focusedIndex: number | null
): HeldBlock | null {
	// Past the end the viewport's top is below this list, so the pick stays with its container.
	if (table.model.size === 0 || localTop >= table.model.total()) return null;
	const topIndex = table.model.indexAtOffset(localTop);
	const focused = focusedIndex ?? -1;
	if (focused >= topIndex && focused < table.ids.length) return pick(table, focused, true);
	// At 0 the viewport's top is above this list, in its container's chrome or further up.
	return localTop === 0 ? null : pick(table, topIndex, false);
}

/** Where `held` sits in `after`, or -1 when the change removed it, or moved the caret's block
 *  (a reorder moves its block on a still page, so that block isn't held). */
export function heldIndexIn(held: HeldBlock, before: HeightTable, after: HeightTable): number {
	if (after === before) return held.index;
	const index = after.ids.indexOf(held.id);
	if (index === -1 || !held.focused) return index;
	return movedAcross(before, after, held.index, index) ? -1 : index;
}

/** The distance a round corrects by: the held block's offset after it minus before. */
export function heldDelta(before: number, after: number): HeldDelta {
	return (after - before) as HeldDelta;
}

function pick(table: HeightTable, index: number, focused: boolean): HeldBlock {
	return { id: table.ids[index], index, focused } as HeldBlock;
}

// A block whose surviving neighbours changed was moved by the edit.
function movedAcross(
	before: HeightTable,
	after: HeightTable,
	index: number,
	afterIndex: number
): boolean {
	recordNeighbourPass();
	const inAfter = new Set(after.ids);
	const inBefore = new Set(before.ids);
	return (
		survivingNeighbour(before.ids, index, -1, inAfter) !==
			survivingNeighbour(after.ids, afterIndex, -1, inBefore) ||
		survivingNeighbour(before.ids, index, 1, inAfter) !==
			survivingNeighbour(after.ids, afterIndex, 1, inBefore)
	);
}

function survivingNeighbour(
	ids: readonly string[],
	index: number,
	step: 1 | -1,
	survivors: ReadonlySet<string>
): string | undefined {
	for (let i = index + step; i >= 0 && i < ids.length; i += step) {
		if (survivors.has(ids[i])) return ids[i];
	}
	return undefined;
}
