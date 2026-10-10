/**
 * The checks a stored selection passes before it goes back onto the live editor: each endpoint
 * resolved against the current tree and clamped into its block. `caret-landing.ts :: restore` puts
 * every stored selection back, a gap caret through {@link restoreGapCaret}.
 */

import type { DocumentView } from '../core/node-views';
import type { BlockComponent } from '../block-component';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { cellPoint, type SelectionPoint } from './primitives';
import { placeGapCaret } from './place-caret';
import { gapScopeChildren, type GapCaretPosition } from './gap-caret';
import { clampCellIndex, countsCells } from '../schema/block-kind-descriptor';
import type { SelectionState } from './selection-state.svelte';
import type { CaretMemory } from '../caret/caret-memory';
import type { CaretWriter } from '../caret/widget-offset';

/**
 * `unresolvable` is decided before anything happens and is the only outcome that leaves the
 * editor untouched. `unplaced` is everything short of both halves landing; the mount and, on
 * the overlay route, the cross-block state write have already run.
 */
export type SelectionRestoreOutcome = 'applied' | 'unresolvable' | 'unplaced';

export interface GapCaretRestoreDeps {
	getDoc(): DocumentView;
	selectionState: SelectionState;
	caretWriter: CaretWriter;
	/** Mounts the block at `path`: the caret landing's `mount`. */
	mount(path: number[]): Promise<BlockComponent | null>;
	/** Brings the mounted block into view as the restore's reveal policy says. */
	reveal(path: number[]): Promise<void>;
	/** Cleared on each restore, since a placed caret did not arrive by a key. */
	caretMemory: Pick<CaretMemory, 'forget'>;
}

/** Restores a gap caret with only the child-list check: the tree is the one the gap was made
 *  against, so its `gapEdges` hold, but the path may name something no BlockList renders. */
export async function restoreGapCaret(
	pos: GapCaretPosition,
	deps: GapCaretRestoreDeps
): Promise<SelectionRestoreOutcome> {
	const children = gapScopeChildren(deps.getDoc(), pos.parentPath);
	if (!children) return 'unresolvable';
	deps.caretMemory.forget();

	const index = Math.min(Math.max(pos.index, 0), children.length);
	// The boundary itself mounts nothing; what must be on screen is the block it sits
	// against, so the gap's own BlockList is inside a live window when it renders.
	const neighbour = index < children.length ? index : index - 1;
	const neighbourPath = [...pos.parentPath, neighbour];
	const mounted = (await deps.mount(neighbourPath)) !== null;
	if (mounted) await deps.reveal(neighbourPath);
	placeGapCaret(deps.selectionState, deps.caretWriter, { parentPath: pos.parentPath, index });
	return mounted ? 'applied' : 'unplaced';
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
