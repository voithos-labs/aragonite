/**
 * Barrel re-exports for the tree-operations directory.
 * Existing import sites — `from '../tree-operations'` or
 * `from '../../tree-operations'` — continue to resolve here after the split.
 * Internal callers may import directly from a sibling file for specificity.
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
	isItemUserEmpty
} from './list-ops';

export { unwrapFirstChildFromBlockquote } from './blockquote';
export { createBlockquoteOverrides } from './blockquote-context';

export { cascadeCleanupEmptyAncestors } from './cleanup';

export { buildPastedReplacement } from './paste-replacement';

export { cloneDocument, cloneNode } from './clone';

export { generateBlockId, assignIds } from './block-id';

export type { MergeRole, MergeTarget } from './merge-rules';
export {
	isMergeEligible,
	isBlockEditable,
	findMergeTarget,
	walkToDeepestMergeLeaf,
	getMergeRole
} from './merge-rules';

export type { BlockKindDescriptor } from './block-kind-descriptor';
export {
	registerBlockKind,
	getBlockKindDescriptor,
	tryGetBlockKindDescriptor
} from './block-kind-descriptor';
