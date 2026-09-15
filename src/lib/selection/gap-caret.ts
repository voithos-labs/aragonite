/**
 * Where a caret can sit between two sibling blocks: the boundaries no block's own editable
 * element can reach, read off the kinds' `gapEdges`. The eligibility checks are pure (document
 * in, boolean out); `tryGapStop` is the one call that places the caret. A gap is deliberately
 * not a `SelectionPoint`: it is never a cross-block endpoint.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { isReadingMode, type PresentationMode } from '../presentation-mode';
import { placeGapCaret } from './caret-doors';
import type { SelectionState } from './selection-state.svelte';

/** The boundary before child `index` of the container at `parentPath`; root is `[]`. */
export interface GapCaretPosition {
	parentPath: number[];
	index: number;
}

/**
 * A boundary is eligible when every block facing it declares that edge — an unregistered or
 * undeclared kind refuses on its side. The root's trailing boundary is excluded: the
 * move-past-end append (`editor-actions/focus/focus.ts`) already owns it.
 */
export function gapEligibleAt(doc: DocumentView, parentPath: number[], index: number): boolean {
	const children = gapScopeChildren(doc, parentPath);
	if (!children) return false;
	return gapEligibleAmong(children, index, parentPath.length > 0);
}

/**
 * The same rule for a caller that already has the children in hand (the block list renderer)
 * and no path to resolve. `ownsTrailingBoundary` is false for the root, whose trailing
 * boundary belongs to the move-past-end append.
 */
export function gapEligibleAmong(
	children: readonly NodeView[],
	index: number,
	ownsTrailingBoundary: boolean
): boolean {
	if (index < 0 || index > children.length) return false;

	if (index === 0) return declaresEdge(children[0], 'before');
	if (index === children.length) {
		return ownsTrailingBoundary && declaresEdge(children[index - 1], 'after');
	}
	return declaresEdge(children[index - 1], 'after') && declaresEdge(children[index], 'before');
}

/**
 * The children a gap could sit between at `parentPath`, or null when that path names no child
 * list a BlockList renders. Undo's restore uses it too, so a stale path cannot put a caret
 * where nothing would paint it.
 */
export function gapScopeChildren(
	doc: DocumentView,
	parentPath: number[]
): readonly NodeView[] | null {
	const parent = nodeAt(doc, parentPath);
	if (!parent) return null;
	if (isBlockNode(parent) && !tryGetBlockKindDescriptor(parent.kind)?.isContainer) return null;
	const children = parent.children;
	return children && children.length > 0 ? children : null;
}

function declaresEdge(node: NodeView, edge: 'before' | 'after'): boolean {
	const edges = tryGetBlockKindDescriptor(node.kind)?.gapEdges;
	return edges === edge || edges === 'both';
}

// ── Arrival ─────────────────────────────────────────────────────────────────

/** What placing a gap caret needs beyond the boundary itself. Getters, so a stop bound early
 *  reads live values. */
export interface GapStopScope {
	getDoc: () => DocumentView;
	selection: SelectionState;
	getPresentationMode?: () => PresentationMode;
}

/**
 * Whether a gesture may put the caret in this gap. Reading mode never may: it has no caret at
 * all, so the gesture keeps its old landing. A caller that must act between the decision and
 * the placement asks this, then calls `placeGapCaret` itself.
 */
export function canGapStop(
	scope: GapStopScope,
	parentPath: number[],
	boundaryIndex: number
): boolean {
	if (isReadingMode(scope.getPresentationMode)) return false;
	return gapEligibleAt(scope.getDoc(), parentPath, boundaryIndex);
}

/** Puts the caret at an eligible `boundaryIndex` and reports whether it did, so a traversal
 *  can stop instead of entering its target. */
export function tryGapStop(
	scope: GapStopScope,
	parentPath: number[],
	boundaryIndex: number
): boolean {
	if (!canGapStop(scope, parentPath, boundaryIndex)) return false;
	placeGapCaret(scope.selection, { parentPath, index: boundaryIndex });
	return true;
}
