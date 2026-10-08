/**
 * Writes the ancestor fix-up's results to state (`tree-operations/chain-rebuild.ts`): a
 * container that collapsed after an edit (an `AncestrySeamFold`) splices its parent's children,
 * a list the commit's own change never covers, so that list's ids and refs are resynced here.
 */

import type { CstNode } from '../core/nodes';
import type { AncestrySeamFold } from '../tree-operations/chain-rebuild';
import {
	applyStructuralChangeToIdsRefs,
	type StructuralChange
} from '../tree-operations/structural-change';
import { spliceMany } from '../tree-operations/splice-many';
import { assignIds } from '../block-id';
import { getStateForNode } from '../block-lists/state-registry';
import { replaceRefs } from '../block-lists/child-refs';
import type { BlockComponent } from '../block-component';
import type { EditorActionsDeps } from './deps';

/** Where the collapsed container's first byte ended up, as a document path. */
export interface FoldLanding {
	path: number[];
	offset: number;
}

/**
 * Resync ids and refs for every collapse and return the function that undoes them, which a
 * commit rolling back runs beside its own restores.
 */
export function publishAncestryFolds(
	deps: EditorActionsDeps,
	folds: readonly AncestrySeamFold[]
): () => void {
	const restores: (() => void)[] = [];
	for (const fold of folds) {
		restores.push(fold.owner ? publishContainerFold(deps, fold) : publishDocFold(deps, fold));
	}
	return () => {
		for (let i = restores.length - 1; i >= 0; i--) restores[i]();
	};
}

/** Where the caret goes after a collapse recreated the blocks in its range. The last collapse is
 *  the outermost (innermost rebuilds first), so its index is the only one still addressable. */
export function foldLandingFor(
	folds: readonly AncestrySeamFold[],
	scopePath: readonly number[]
): FoldLanding | null {
	const fold = folds[folds.length - 1];
	if (!fold) return null;
	return {
		path: [...scopePath.slice(0, fold.depth), fold.landing.index],
		offset: fold.landing.offset
	};
}

/**
 * A splice made outside a commit, written to state the way a commit writes the change its
 * mutate returns. `owner` is the container whose children moved, or undefined for the document.
 */
export function publishScopeFold(
	deps: EditorActionsDeps,
	owner: CstNode | undefined,
	change: StructuralChange
): void {
	if (change.op === 'noop') return;
	if (owner) publishContainerScope(owner, change);
	else publishDocScope(deps, change);
}

function publishDocScope(deps: EditorActionsDeps, change: StructuralChange): void {
	const ids = [...deps.blockIds];
	const refs = [...deps.blockRefs];
	applyStructuralChangeToIdsRefs(change, ids, refs);
	deps.setBlockIds(ids);
	deps.setBlockRefs(refs);
}

/**
 * Ids live on the owner node, which is what an unmounted container's BlockListState reads back;
 * refs live on the state and only exist while the container is mounted.
 */
function publishContainerScope(owner: CstNode, change: StructuralChange): void {
	const state = getStateForNode(owner);
	// A never-mounted container has no ids to keep, so fresh ids for the surviving children are
	// the whole answer; the change applied to an array that never held them misshapes it (G1.36).
	if (!owner.childIds) {
		owner.childIds = assignIds(owner.children ?? []);
		return;
	}
	const ids = [...owner.childIds];
	const refs: (BlockComponent | undefined)[] = state ? [...state.innerBlockRefs] : [];
	applyStructuralChangeToIdsRefs(change, ids, refs);
	owner.childIds = ids;
	if (state) replaceRefs(state.innerBlockRefs, refs);
}

function publishDocFold(deps: EditorActionsDeps, fold: AncestrySeamFold): () => void {
	const savedIds = [...deps.blockIds];
	const savedRefs = [...deps.blockRefs];
	publishScopeFold(deps, undefined, fold.change);
	return () => {
		deps.setBlockIds(savedIds);
		deps.setBlockRefs(savedRefs);
		restoreChildren(fold);
	};
}

function publishContainerFold(deps: EditorActionsDeps, fold: AncestrySeamFold): () => void {
	const owner = fold.owner!;
	const state = getStateForNode(owner);
	const savedIds = owner.childIds;
	const savedRefs: (BlockComponent | undefined)[] = state ? [...state.innerBlockRefs] : [];
	publishScopeFold(deps, owner, fold.change);
	return () => {
		owner.childIds = savedIds;
		if (state) replaceRefs(state.innerBlockRefs, savedRefs);
		restoreChildren(fold);
	};
}

/** The whole pre-splice array: a collapse recreates several nodes, so nothing narrower
 *  restores them. */
function restoreChildren(fold: AncestrySeamFold): void {
	spliceMany(fold.siblings, 0, fold.siblings.length, fold.before);
}
