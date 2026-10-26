export type { NodeParent } from './node-primitives';
export {
	nodeAt,
	emptyParagraph,
	paragraphNode,
	normalizeReplacementTrivia
} from './node-primitives';
export { restoreSeparatorOnFill } from './separator-writes';
export { reclassifyContainer } from './content-write';
export type { MergeIntoPrevResult, MergeResult, SplitResult } from './node-ops';
export {
	splitNode,
	assertSingleNodeSink,
	mergeWithNext,
	mergeIntoPrevDeepLeaf,
	deleteNode
} from './node-ops';

export { unwrapFirstItemFromList, mergeListItemIntoPrevious } from './list/unwrap-merge';
export { isItemUserEmpty } from './list/empty-check';
export { buildExitReplacement } from './list/exit-replacement';
export { landAtTaskStart, writeKeepingTaskMarker } from './list/reconcile-task';

export { plainQuote } from './blockquote';
export { liftFirstChild, sameContainer } from './container-lift';

export type { CellPos } from './sub-table-copy';

export { cascadeCleanupEmptyAncestors } from './cleanup';

export { ensureUnsharedPath, ensureUnsharedChild } from './unshare';

export { buildPastedReplacement } from './paste/paste-replacement';
