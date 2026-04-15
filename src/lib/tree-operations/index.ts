/**
 * Barrel re-exports for the tree-operations directory.
 * Existing import sites — `from '../tree-operations'` or
 * `from '../../tree-operations'` — continue to resolve here after the split.
 * Internal callers may import directly from `./generic`, `./list-ops`, or
 * `./blockquote` for specificity.
 */

export type { NodeParent } from './generic';
export {
	splitNode,
	mergeWithPrevious,
	mergeWithNext,
	deleteNode,
	updateNodeContent,
	ensureEditableContainers,
	rebuildAncestryRaw
} from './generic';

export {
	unwrapFirstItemFromList,
	mergeListItemIntoPrevious,
	renumberOrderedList,
	normalizeItemMarkerToList,
	isItemUserEmpty
} from './list-ops';

export { unwrapFirstChildFromBlockquote } from './blockquote';
