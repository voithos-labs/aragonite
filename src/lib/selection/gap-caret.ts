/**
 * Where a caret can live BETWEEN two sibling blocks: the boundaries no block's own editing
 * surface can reach, read off the kinds' `gapEdges` declarations. Eligibility is pure — doc
 * in, boolean out; `tryGapStop` is the one seam that turns it into an arrival.
 * The gap is deliberately not a `SelectionPoint`: it is never a cross-block endpoint.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { isBlockNode, nodeAt } from '../tree-operations/node-ops';
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
	const parent = nodeAt(doc, parentPath);
	if (!parent) return false;
	if (isBlockNode(parent) && !tryGetBlockKindDescriptor(parent.kind)?.isContainer) return false;

	const children = parent.children;
	if (!children || children.length === 0) return false;
	if (index < 0 || index > children.length) return false;

	if (index === 0) return declaresEdge(children[0], 'before');
	if (index === children.length) {
		return parentPath.length > 0 && declaresEdge(children[index - 1], 'after');
	}
	return declaresEdge(children[index - 1], 'after') && declaresEdge(children[index], 'before');
}

function declaresEdge(node: NodeView, edge: 'before' | 'after'): boolean {
	const edges = tryGetBlockKindDescriptor(node.kind)?.gapEdges;
	return edges === edge || edges === 'both';
}

// ── Arrival ─────────────────────────────────────────────────────────────────

/** What an arrival needs beyond the boundary itself. Getters, so a bound stop reads live. */
export interface GapStopScope {
	getDoc: () => DocumentView;
	selection: SelectionState;
	getPresentationMode?: () => PresentationMode;
}

/**
 * Whether an arriving gesture may park here. Reading mode never may: it has no caret at
 * all, so the gesture keeps its old landing. A caller that must act BETWEEN the decision
 * and the landing asks this, then goes through the door itself.
 */
export function canGapStop(
	scope: GapStopScope,
	parentPath: number[],
	boundaryIndex: number
): boolean {
	if (isReadingMode(scope.getPresentationMode)) return false;
	return gapEligibleAt(scope.getDoc(), parentPath, boundaryIndex);
}

/** Park the caret at an eligible `boundaryIndex`, reporting whether it did — so a
 *  traversal can stop instead of entering its target. */
export function tryGapStop(
	scope: GapStopScope,
	parentPath: number[],
	boundaryIndex: number
): boolean {
	if (!canGapStop(scope, parentPath, boundaryIndex)) return false;
	placeGapCaret(scope.selection, { parentPath, index: boundaryIndex });
	return true;
}
