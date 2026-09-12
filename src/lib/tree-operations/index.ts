export type { NodeParent } from './node-primitives';
export {
	nodeAt,
	emptyParagraph,
	paragraphNode,
	ensureEditableContainers,
	normalizeReplacementTrivia
} from './node-primitives';
export {
	deleteNode,
	focusTargetInReplacement,
	restoreSeparatorOnFill,
	dropDoubledSeparator
} from './settle';
export { updateNodeContent, reclassifyContainer } from './content-write';
export type { MergeIntoPrevResult, MergeResult, SplitResult } from './node-ops';
export {
	splitNode,
	assertSplitLanding,
	assertSingleNodeSink,
	mergeWithNext,
	mergeIntoPrevDeepLeaf
} from './node-ops';

export { unwrapFirstItemFromList, mergeListItemIntoPrevious } from './list/unwrap-merge';
export { renumberOrderedList, normalizeItemMarkerToList } from './list/ordered-markers';
export { isItemUserEmpty } from './list/empty-check';
export { buildExitReplacement } from './list/exit-replacement';
export { reconcileTaskMetadata } from './list/reconcile-task';

export { unwrapFirstChildFromQuote } from './blockquote';
export { liftFirstChildKeepingContainer } from './container-lift';

export {
	insertEmptyRow,
	insertEmptyColumn,
	deleteRow,
	deleteColumn,
	cycleAlignment
} from './table-mutations';
export { copyRectangleAsSubTable } from './sub-table-copy';
export type { CellPos } from './sub-table-copy';

export { cascadeCleanupEmptyAncestors } from './cleanup';

export {
	ensureUnsharedPath,
	ensureUnsharedChild,
	ensureUnsharedNode,
	ensureUnsharedChildren,
	ensureUnsharedSubtree,
	rebuildOwnedContainer
} from './unshare';
export { rebuildUnsharedChain, rebuildUnsharedAncestry } from './chain-rebuild';

export { buildPastedReplacement } from './paste/paste-replacement';

export { cloneDocument, cloneNode } from './clone';
