export type { NodeParent } from './node-ops';
export {
	splitNode,
	mergeWithPrevious,
	mergeWithNext,
	deleteNode,
	updateNodeContent,
	ensureEditableContainers,
	normalizeReplacementTrivia,
	nodeAt
} from './node-ops';

export {
	rebuildAncestryRaw,
	rebuildContainerRaw,
	rebuildContainerRawIfContainer
} from './container-raw';

export { unwrapFirstItemFromList, mergeListItemIntoPrevious } from './list/unwrap-merge';
export { renumberOrderedList, normalizeItemMarkerToList } from './list/ordered-markers';
export { isItemUserEmpty } from './list/empty-check';
export { buildExitReplacement } from './list/exit-replacement';

export { unwrapFirstChildFromBlockquote } from './blockquote';

export { cascadeCleanupEmptyAncestors } from './cleanup';

export { buildPastedReplacement } from './paste-replacement';

export { cloneDocument, cloneNode } from './clone';

export { generateBlockId, assignIds } from './block-id';

export type { MergeTarget } from './merge-rules';
export {
	isMergeEligible,
	isBlockEditable,
	findMergeTarget,
	walkToDeepestMergeLeaf,
	getMergeRole
} from './merge-rules';

export type { MergeRole } from './block-kind-descriptor';

export type { StructuralChange } from './structural-change';

export type { BlockKindDescriptor } from './block-kind-descriptor';
export {
	registerBlockKind,
	getBlockKindDescriptor,
	tryGetBlockKindDescriptor
} from './block-kind-descriptor';
