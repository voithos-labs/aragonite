/**
 * Publishing side of the ancestry settle (`tree-operations/unshare.ts`): a fold at a container's
 * own slot splices its PARENT's children, a scope the commit's own change descriptor never
 * covers, so that scope's ids and refs are resynced here instead.
 */

import type { AncestrySeamFold } from '../tree-operations/unshare';
import { applyStructuralChangeToIdsRefs } from '../tree-operations/structural-change';
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
		restores.push(fold.owner ? publishContainerFold(fold) : publishDocFold(deps, fold));
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

function publishDocFold(deps: EditorActionsDeps, fold: AncestrySeamFold): () => void {
	const savedIds = [...deps.blockIds];
	const savedRefs = [...deps.blockRefs];
	const ids = [...savedIds];
	const refs = [...savedRefs];
	applyStructuralChangeToIdsRefs(fold.change, ids, refs);
	deps.setBlockIds(ids);
	deps.setBlockRefs(refs);
	return () => {
		deps.setBlockIds(savedIds);
		deps.setBlockRefs(savedRefs);
		restoreChildren(fold);
	};
}

/**
 * Ids live on the owner node, which is what an unmounted container's BlockListState reads back;
 * refs live on the state and only exist while the scope is mounted.
 */
function publishContainerFold(fold: AncestrySeamFold): () => void {
	const owner = fold.owner!;
	const state = getStateForNode(owner);
	const savedIds = owner.childIds ? [...owner.childIds] : undefined;
	const savedRefs: (BlockComponent | undefined)[] = state ? [...state.innerBlockRefs] : [];
	const ids = [...(savedIds ?? [])];
	const refs = [...savedRefs];
	applyStructuralChangeToIdsRefs(fold.change, ids, refs);
	owner.childIds = ids;
	if (state) replaceRefs(state.innerBlockRefs, refs);
	return () => {
		owner.childIds = savedIds;
		if (state) replaceRefs(state.innerBlockRefs, savedRefs);
		restoreChildren(fold);
	};
}

/** The whole pre-splice array: a fold re-mints plural slots, so no narrower register covers it. */
function restoreChildren(fold: AncestrySeamFold): void {
	fold.siblings.splice(0, fold.siblings.length, ...fold.before);
}
