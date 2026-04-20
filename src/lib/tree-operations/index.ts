/**
 * Barrel re-exports for the tree-operations directory.
 */

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

export {
	unwrapFirstItemFromList,
	mergeListItemIntoPrevious,
	renumberOrderedList,
	normalizeItemMarkerToList,
	isItemUserEmpty,
	buildExitReplacement
} from './list-ops';

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

export type { BlockKindDescriptor } from './block-kind-descriptor';
export {
	registerBlockKind,
	getBlockKindDescriptor,
	tryGetBlockKindDescriptor
} from './block-kind-descriptor';
