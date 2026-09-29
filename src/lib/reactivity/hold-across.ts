/**
 * Which block stays still across a measure round, picked level by level down the document's
 * block lists, and how far it moved. See `docs/design/virtual-rendering.md` § Keeping the page
 * still while heights change.
 */
import type { HeightModel } from '../cursor/height-model';
import { recordNeighbourPass } from '../perf/instruments';

/** A list's block heights, with the ids they were built from lined up by index. */
export interface HeightTable {
	readonly model: HeightModel;
	/** A snapshot, so a correction finds its held block by id in the order from before a change. */
	readonly ids: readonly string[];
}

declare const picked: unique symbol;
declare const measured: unique symbol;

/** The block a list keeps still, with its index in the table it was picked from. Only
 *  `heldBlock` makes one. */
export type HeldBlock = { readonly id: string; readonly index: number; readonly [picked]: true };

/** How far the held block's top moved across a round. Only `heldPathMoved` makes one, so a
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

/** The focused block (`focusedIndex`, counted in `after`) when it sits at or below `localTop` and
 *  the change didn't move it; else the block at the top; else none. */
export function heldBlock(
	before: HeightTable,
	after: HeightTable,
	localTop: number,
	focusedIndex: number | null
): HeldBlock | null {
	// Past the end the viewport's top is below this list, so the pick stays with its container.
	if (before.model.size === 0 || localTop >= before.model.total()) return null;
	const topIndex = before.model.indexAtOffset(localTop);
	const onScreen = focusedIndex ?? -1;
	const focused = indexBefore(before, after, onScreen);
	if (focused >= topIndex && !movedAcross(before, after, focused, onScreen)) {
		return pick(before, focused);
	}
	// At 0 the viewport's top is above this list, in its container's chrome or further up.
	return localTop === 0 ? null : pick(before, topIndex);
}

/** One level of a held block's path: the block a list picked, where its top sat then, and the
 *  list's table as it reads now. */
export interface HeldStep {
	readonly held: HeldBlock;
	readonly table: HeightTable;
	readonly top: number;
	readonly current: () => HeightTable;
}

export function heldStep(
	table: HeightTable,
	held: HeldBlock,
	current: () => HeightTable
): HeldStep {
	return { held, table, top: table.model.offsetOf(held.index), current };
}

/** How far the block at the end of `path` moved since it was picked: each level's move, found by
 *  id, down to the first level whose block the change removed. */
export function heldPathMoved(path: readonly HeldStep[]): HeldDelta {
	let moved = 0;
	for (const { held, table, top, current } of path) {
		const next = current();
		// A measure keeps its table, so the round each keystroke closes skips the lookup.
		const index = next === table ? held.index : next.ids.indexOf(held.id);
		if (index === -1) break;
		moved += next.model.offsetOf(index) - top;
	}
	return moved as HeldDelta;
}

function pick(table: HeightTable, index: number): HeldBlock {
	return { id: table.ids[index], index } as HeldBlock;
}

// A measure keeps one table, so the per-keystroke path pays no id lookup.
function indexBefore(before: HeightTable, after: HeightTable, afterIndex: number): number {
	if (afterIndex < 0 || afterIndex >= after.ids.length) return -1;
	return after === before ? afterIndex : before.ids.indexOf(after.ids[afterIndex]);
}

// A reorder moves its block on a still page, so a block whose surviving neighbours changed isn't held.
function movedAcross(
	before: HeightTable,
	after: HeightTable,
	index: number,
	afterIndex: number
): boolean {
	if (after === before) return false;
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
