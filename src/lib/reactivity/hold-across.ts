/**
 * Which block a list keeps still across a height change, picked in one place for every
 * correction a list makes: a measured block, a rebuilt table. See `docs/design/virtual-rendering.md`
 * § Keeping the page still while heights change.
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

/** How far the held block's top moved across a change. Only `holdAcross` makes one, so a list
 *  can't correct by a distance it worked out some other way. */
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
	// Past the end this whole list is above the viewport, so the list it sits in corrects for it.
	if (before.model.size === 0 || localTop >= before.model.total()) return null;
	const topIndex = before.model.indexAtOffset(localTop);
	const onScreen = focusedIndex ?? -1;
	const focused = indexBefore(before, after, onScreen);
	if (focused >= topIndex && !movedAcross(before, after, focused, onScreen)) {
		return pick(before, focused);
	}
	// At 0 the viewport's top sits in a list above this one, whose own correction holds it.
	return localTop === 0 ? null : pick(before, topIndex);
}

/** Run `mutate` and return how far the held block's top moved, found by id in `after`. Zero when
 *  nothing is held or the change removed it. */
export function holdAcross(
	before: HeightTable,
	after: () => HeightTable,
	held: HeldBlock | null,
	mutate: () => void
): HeldDelta {
	if (held === null) {
		mutate();
		return 0 as HeldDelta;
	}
	const top = before.model.offsetOf(held.index);
	mutate();
	const next = after();
	// The same table keeps every index, so the measure that runs on each keystroke skips the lookup.
	const index = next === before ? held.index : next.ids.indexOf(held.id);
	return (index === -1 ? 0 : next.model.offsetOf(index) - top) as HeldDelta;
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
