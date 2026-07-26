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
import { metadataOf } from '../core/nodes';
import { isBlockNode, nodeAt } from '../tree-operations/node-ops';
import type { BlockComponent } from '../block-component';
import type { BlockElLookup } from '../editor-keys';
import type { EditorSelection, SelectionPoint } from './primitives';
import { applySelectionToDom } from './native-bridge';
import type { SelectionState } from './selection-state.svelte';

export interface SelectionRestoreDeps {
	getDoc(): DocumentView;
	selectionState: SelectionState;
	getBlockElByPath: BlockElLookup;
	revealPath(path: number[]): Promise<BlockComponent | null>;
}

/**
 * Restore a snapshot. Resolves `false` — never throws — when either endpoint's
 * path no longer addresses a block; that branch reveals nothing, focuses
 * nothing and stores nothing, so a stale snapshot cannot move the viewport.
 *
 * `true` means resolve, reveal and placement all succeeded. The focus block is
 * in view by construction of the reveal, so no rect is measured to confirm it.
 */
export async function restoreSelection(
	selection: EditorSelection,
	deps: SelectionRestoreDeps
): Promise<boolean> {
	const doc = deps.getDoc();
	const anchor = resolveSelectionPoint(doc, selection.anchor);
	const focus = resolveSelectionPoint(doc, selection.focus);
	if (!anchor || !focus) return false;

	// Reveal exactly what the applier parks the caret at. A cell-coordinate focus
	// parks in its deep [table, row, col] cell, and table rows window too — so
	// revealing the table block alone would leave an off-window row unmounted.
	await deps.revealPath(deps.selectionState.cellDeepPath(focus) ?? focus.path);
	return applySelectionToDom({ anchor, focus }, deps.selectionState, deps.getBlockElByPath);
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
 */
export function resolveSelectionPoint(
	doc: DocumentView,
	point: SelectionPoint
): SelectionPoint | null {
	const node = nodeAt(doc, point.path);
	if (node === null || !isBlockNode(node)) return null;

	const limit =
		node.kind === 'table'
			? (node.children?.length ?? 0) * metadataOf(node, 'table').columnCount - 1
			: node.raw.length;
	const offset = Math.min(Math.max(point.offset, 0), Math.max(limit, 0));

	// Path copied so a restored endpoint never aliases the caller's snapshot.
	return point.cellCoordinate
		? { path: point.path.slice(), offset, cellCoordinate: true }
		: { path: point.path.slice(), offset };
}
