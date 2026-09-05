/**
 * Publishing side of the ancestry settle (`tree-operations/unshare.ts`): a fold at a container's
 * own slot splices its PARENT's children, a scope the commit's own change descriptor never
 * covers, so that scope's ids and refs are resynced here instead.
 */

import type { CstNode } from '../core/nodes';
import type { AncestrySeamFold } from '../tree-operations/unshare';
import {
	applyStructuralChangeToIdsRefs,
	type StructuralChange
} from '../tree-operations/structural-change';
import { spliceMany } from '../tree-operations/splice-many';
import { assignIds } from '../block-id';
import { getStateForNode } from '../reactivity/state-registry';
import { replaceRefs } from '../reactivity/publish-ref.svelte';
import type { BlockComponent } from '../block-component';
import type { EditorActionsDeps } from './deps';

/** Where the folded container's first byte ended up, as a document path. */
export interface FoldLanding {
	path: number[];
	offset: number;
}

/**
 * Resync every folded scope's ids/refs and return the unwind for them, which a commit rolling
 * back runs beside its own registers.
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

/**
 * The landing a fold owes the caret: the container's slot is always gone (the reparse re-mints
 * every block in the folded window), so a door whose focus addressed it has nothing to land on.
 * `scopePath` is the committing scope's own path, from which the fold's depth names the parent.
 * The chain rebuilds innermost-first, so the LAST fold is the outermost one — the one whose slot
 * swallowed the others, and the only landing still addressable after them all.
 */
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
 * A splice made outside the commit ceremony, published as the ceremony publishes the change its
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
 * refs live on the state and only exist while the scope is mounted.
 */
function publishContainerScope(owner: CstNode, change: StructuralChange): void {
	const state = getStateForNode(owner);
	// A container that never mounted has no ids to carry across, and this runs AFTER the fold —
	// so one fresh id per surviving child is the whole answer, where a descriptor over a window
	// the seeded array never held would mis-shape it (G1.36).
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

/** The whole pre-splice array: a fold re-mints plural slots, so no narrower register covers it. */
function restoreChildren(fold: AncestrySeamFold): void {
	spliceMany(fold.siblings, 0, fold.siblings.length, fold.before);
}
