/**
 * Barrel re-exports for the tree-operations directory.
 * Existing import sites — `from '../tree-operations'` or
 * `from '../../tree-operations'` — continue to resolve here after the split.
 * Internal callers may import directly from a sibling file for specificity.
 */

export type { NodeParent } from './generic';
export {
	splitNode,
	mergeWithPrevious,
	mergeWithNext,
	deleteNode,
	updateNodeContent,
	ensureEditableContainers,
	rebuildAncestryRaw,
	rebuildContainerRaw,
	rebuildContainerRawIfContainer,
	nodeAt
} from './generic';

export {
	unwrapFirstItemFromList,
	mergeListItemIntoPrevious,
	renumberOrderedList,
	normalizeItemMarkerToList,
	isItemUserEmpty
} from './list-ops';

export { unwrapFirstChildFromBlockquote } from './blockquote';

export { cascadeCleanupEmptyAncestors } from './cleanup';

export { cloneDocument, cloneNode } from './clone';

export { generateBlockId, assignIds } from './block-id';

export type { MergeRole, MergeTarget } from './merge-rules';
export {
	MERGE_ROLE,
	isMergeEligible,
	isBlockEditable,
	findMergeTarget,
	walkToDeepestMergeLeaf
} from './merge-rules';
