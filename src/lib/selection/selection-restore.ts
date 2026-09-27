/**
 * The one path from a stored selection back onto the live editor: resolve it against the current
 * tree, mount the block the caret will land in, then place it. Undo/redo and the consumer's
 * `setSelection` both come through here, so the resolve, clamp and mount rules can't differ. A
 * gap caret takes {@link restoreGapCaret}, the same steps minus the endpoint pair.
 */

import type { DocumentView } from '../core/node-views';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import type { BlockElLookup } from '../editor-keys';
import { cellPoint, type EditorSelection, type SelectionPoint } from './primitives';
import { applySelectionToDom } from './native-bridge';
import { placeGapCaret } from './caret-doors';
import { gapScopeChildren, type GapCaretPosition } from './gap-caret';
import { clampCellIndex, countsCells } from '../schema/block-kind-descriptor';
import type { SelectionState } from './selection-state.svelte';
import type { CaretMemory } from '../cursor/caret-memory';

/**
 * `unresolvable` is decided before anything happens and is the only outcome that leaves the
 * editor untouched. `unplaced` is everything short of both halves landing; the mount and, on
 * the overlay route, the cross-block state write have already run.
 */
export type SelectionRestoreOutcome = 'applied' | 'unresolvable' | 'unplaced';

export interface SelectionRestoreDeps {
	getDoc(): DocumentView;
	selectionState: SelectionState;
	getBlockElByPath: BlockElLookup;
	/** Mounts the block the caret will land in and reports whether it is ready. Injected because
	 *  which path gets mounted is this module's rule and how far to scroll is the caller's. */
	revealTarget(path: number[]): Promise<boolean>;
	/** Cleared on each restore, since a placed caret did not arrive by a key. */
	caretMemory: Pick<CaretMemory, 'forget'>;
}

/** Restores a snapshot and never throws. An endpoint whose path addresses no block is declined
 *  before anything mounts, so a dead snapshot moves no viewport and disturbs no live selection. */
export async function restoreSelection(
	selection: EditorSelection,
	deps: SelectionRestoreDeps
): Promise<SelectionRestoreOutcome> {
	const doc = deps.getDoc();
	const anchor = resolveSelectionPoint(doc, selection.anchor);
	const focus = resolveSelectionPoint(doc, selection.focus);
	if (!anchor || !focus) return 'unresolvable';
	deps.caretMemory.forget();

	// Mount exactly what the caret will land in: a cell-coordinate focus lands in its
	// [table, row, col] cell, and table rows are windowed too.
	const revealed = await deps.revealTarget(deps.selectionState.cellLandingFor(focus).path);
	const placed = applySelectionToDom({ anchor, focus }, deps.selectionState, deps.getBlockElByPath);
	return revealed && placed ? 'applied' : 'unplaced';
}

/** Restores a gap caret with only the child-list check: the tree is the one the gap was made
 *  against, so its `gapEdges` hold, but the path may name something no BlockList renders. */
export async function restoreGapCaret(
	pos: GapCaretPosition,
	deps: SelectionRestoreDeps
): Promise<SelectionRestoreOutcome> {
	const children = gapScopeChildren(deps.getDoc(), pos.parentPath);
	if (!children) return 'unresolvable';
	deps.caretMemory.forget();

	const index = Math.min(Math.max(pos.index, 0), children.length);
	// The boundary itself mounts nothing; what must be on screen is the block it sits
	// against, so the gap's own BlockList is inside a live window when it renders.
	const neighbour = index < children.length ? index : index - 1;
	const revealed = await deps.revealTarget([...pos.parentPath, neighbour]);
	placeGapCaret(deps.selectionState, { parentPath: pos.parentPath, index });
	return revealed ? 'applied' : 'unplaced';
}

/** Clamps an endpoint into its block's whole `raw`, markers included, or null when its path names
 *  no block. An offset on a table path comes back flagged as a cell index, even a plain one. */
export function resolveSelectionPoint(
	doc: DocumentView,
	point: SelectionPoint
): SelectionPoint | null {
	const node = nodeAt(doc, point.path);
	if (node === null || !isBlockNode(node)) return null;

	const cells = countsCells(node);
	const offset = cells
		? clampCellIndex(node, point.offset)
		: Math.min(Math.max(point.offset, 0), node.raw.length);

	// Path copied so a restored endpoint never aliases the caller's snapshot.
	return cells || point.cellCoordinate
		? cellPoint(point.path, offset)
		: { path: point.path.slice(), offset };
}
