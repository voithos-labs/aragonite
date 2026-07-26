/**
 * The one road from an `EditorSelection` snapshot back onto the live editor:
 * resolve both endpoints against the current tree, reveal what the caret will be
 * parked at, then hand the pair to the DOM applier.
 *
 * Both restore entry paths — the undo/redo swap and the consumer's
 * `setSelection` door — funnel through here, so the resolve, clamp and reveal
 * rules cannot be carried by one and missed by the other.
 */

import type { DocumentView } from '../core/node-views';
import { isBlockNode, nodeAt } from '../tree-operations/node-ops';
import type { BlockElLookup } from '../editor-keys';
import type { EditorSelection, SelectionPoint } from './primitives';
import { applySelectionToDom } from './native-bridge';
import { tableCellCount } from './table-endpoint-snap';
import type { SelectionState } from './selection-state.svelte';

/**
 * `unresolvable` is decided before anything happens and is the only outcome that
 * leaves the editor untouched; `unplaced` means the target survived resolution
 * but its element was absent from the DOM, so the reveal and — on the custom
 * route — the cross-block state write have already run.
 */
export type SelectionRestoreOutcome = 'applied' | 'unresolvable' | 'unplaced';

export interface SelectionRestoreDeps {
	getDoc(): DocumentView;
	selectionState: SelectionState;
	getBlockElByPath: BlockElLookup;
	/** Make the park target ready and report whether it is. Injected because the two
	 *  restore contracts promise different strengths — which path gets revealed is
	 *  this module's rule, how strongly is the caller's. */
	revealTarget(path: number[]): Promise<boolean>;
}

/**
 * Restore a snapshot. Never throws; an endpoint whose path no longer addresses a
 * block is declined up front, before the reveal, so a dead snapshot cannot move
 * the viewport or disturb a live selection. What a decline should then do about
 * the selection already on screen is the caller's policy, not this module's.
 */
export async function restoreSelection(
	selection: EditorSelection,
	deps: SelectionRestoreDeps
): Promise<SelectionRestoreOutcome> {
	const doc = deps.getDoc();
	const anchor = resolveSelectionPoint(doc, selection.anchor);
	const focus = resolveSelectionPoint(doc, selection.focus);
	if (!anchor || !focus) return 'unresolvable';

	// Reveal exactly what the applier parks the caret at. A cell-coordinate focus
	// parks in its deep [table, row, col] cell, and table rows window too — so
	// revealing the table block alone would leave an off-window row unmounted.
	const revealed = await deps.revealTarget(deps.selectionState.cellDeepPath(focus) ?? focus.path);
	const placed = applySelectionToDom({ anchor, focus }, deps.selectionState, deps.getBlockElByPath);
	return revealed && placed ? 'applied' : 'unplaced';
}

/**
 * Clamp an endpoint into its block's addressable range, or null when its path no
 * longer resolves to a block (the document root included — there is no caret to
 * place there).
 *
 * The NODE KIND picks the coordinate space, not the `cellCoordinate` flag: an
 * intra-table endpoint is unflagged by the same-path convention (see
 * {@link SelectionPoint}) yet still carries a row-major cell index, so a
 * flag-gated clamp would measure it against the table's markdown length. Same
 * discriminant `cellEndpointDeepPath` uses, for the same reason.
 *
 * The char-space bound is `raw`, which on a marker-bearing kind (heading, list
 * item) runs past the editable content end. That is deliberate: this clamp only
 * has to keep the offset finite and in the block, and the DOM walk lands a
 * past-the-content offset on the content end anyway.
 */
export function resolveSelectionPoint(
	doc: DocumentView,
	point: SelectionPoint
): SelectionPoint | null {
	const node = nodeAt(doc, point.path);
	if (node === null || !isBlockNode(node)) return null;

	// Through the extent helper, not a local product: the clamp's ceiling and
	// `cellEndpointDeepPath`'s bounds check must be the same number, or a clamped
	// index gets rejected by the very check it was clamped to satisfy.
	const limit = node.kind === 'table' ? tableCellCount(node) - 1 : node.raw.length;
	const offset = Math.min(Math.max(point.offset, 0), Math.max(limit, 0));

	// Path copied so a restored endpoint never aliases the caller's snapshot.
	return point.cellCoordinate
		? { path: point.path.slice(), offset, cellCoordinate: true }
		: { path: point.path.slice(), offset };
}
