/**
 * The one path from a stored selection back onto the live editor: resolve it against the
 * current tree, mount the block the caret will land in, then place it. Both callers (an
 * undo/redo swap and the consumer's `setSelection`) come through here, so the resolve, clamp
 * and mount rules cannot differ between them. A gap caret takes {@link restoreGapCaret}, the
 * same steps minus the endpoint pair.
 */

import type { DocumentView } from '../core/node-views';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import type { BlockElLookup } from '../editor-keys';
import type { EditorSelection, SelectionPoint } from './primitives';
import { applySelectionToDom } from './native-bridge';
import { placeGapCaret } from './caret-doors';
import { gapScopeChildren, type GapCaretPosition } from './gap-caret';
import { tableCellCount } from './table-endpoint-snap';
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
	/** A placed caret did not arrive by a key, so how an earlier one arrived no longer applies. */
	caretMemory: Pick<CaretMemory, 'forget'>;
}

/**
 * Restores a snapshot. Never throws; an endpoint whose path no longer addresses a block is
 * declined before anything is mounted, so a dead snapshot cannot move the viewport or disturb
 * a live selection. What a decline does about the on-screen selection is the caller's policy.
 */
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

/**
 * Restores a gap caret. Only the child-list check of `gapEligibleAt` runs, not the full
 * eligibility check: the tree being restored is the one the gap was created against, so
 * `gapEdges` cannot have changed, but the path can now name something no BlockList renders.
 */
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

/**
 * Clamps an endpoint into its block's range, or null when its path no longer resolves to a
 * block (the document root included). The node kind picks the coordinate space, not the
 * `cellCoordinate` flag: an endpoint inside a table is unflagged (see {@link SelectionPoint})
 * yet still carries a cell index. The character bound is `raw`, which on a kind with markers
 * runs past the content end; the DOM-to-offset walk puts such an offset at the end.
 */
export function resolveSelectionPoint(
	doc: DocumentView,
	point: SelectionPoint
): SelectionPoint | null {
	const node = nodeAt(doc, point.path);
	if (node === null || !isBlockNode(node)) return null;

	// Through `tableCellCount`, not a local product: this ceiling and `cellEndpointDeepPath`'s
	// bounds check must be the same number, or a clamped index fails that check.
	const limit = node.kind === 'table' ? tableCellCount(node) - 1 : node.raw.length;
	const offset = Math.min(Math.max(point.offset, 0), Math.max(limit, 0));

	// Path copied so a restored endpoint never aliases the caller's snapshot.
	return point.cellCoordinate
		? { path: point.path.slice(), offset, cellCoordinate: true }
		: { path: point.path.slice(), offset };
}
