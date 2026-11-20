/**
 * The list's and the list item's overrides over the default child actions. The list's are
 * item-level no-ops and the last item's forward merge, handed to the parent; the item's is its
 * Enter. Backspace unwrap comes from the list's declared `unwrapRole`, which picks a strategy in
 * `unwrap-strategies.ts`.
 */

import type { BlockEditActions, ListContext } from '../action-contracts';
import { refusedWrite } from './stored-caret';
import { displayLength } from '../core/lines';
import { leavesOnEnter } from '../tree-operations/list/empty-check';
import type { NestedActionsOverrideFactory, NodeScope } from './nested/nested-actions';
import type { CommandRun } from '../schema/block-commands';

export interface ListOverridesDeps {
	scope: NodeScope;
	parentBlockEdit: BlockEditActions;
}

export function createListOverrides(deps: ListOverridesDeps): NestedActionsOverrideFactory {
	return () => ({
		blockEdit: {
			// Items split through the item's own bundle; nothing calls the list's, and the shared
			// core would run a prose split on a `listItem` if anything ever did.
			splitBlock: async (): Promise<boolean> => false,
			updateBlockContent: () => refusedWrite(),

			// Items are structural peers, not text to merge. Only the last item hands the merge
			// to the parent, so the block after the list merges into the list's deepest leaf.
			mergeWithNext: async (itemIndex: number): Promise<boolean> => {
				const node = deps.scope.node;
				if (!node.children || itemIndex < node.children.length - 1) return false;
				return deps.parentBlockEdit.mergeWithNext(deps.scope.index);
			}
		}
	});
}

export interface ListItemOverridesDeps {
	scope: NodeScope;
	/** The enclosing list's context, read before the item provides its own. */
	listContext: ListContext;
}

/** A list item's Enter: an empty item leaves the list (not one a selection's removal emptied), at
 *  the item's end it starts the next item, anywhere else it splits the item. */
export function createListItemOverrides(deps: ListItemOverridesDeps): NestedActionsOverrideFactory {
	return () => ({
		blockEdit: {
			splitBlock: async (
				innerIndex: number,
				offset: number,
				run?: CommandRun
			): Promise<boolean> => {
				const { node, index } = deps.scope;
				if (!node.children) return false;

				if (!run?.afterRemoval && leavesOnEnter(node))
					return deps.listContext.exitListAtItem(index);

				const lastChild = node.children[node.children.length - 1];
				const atEnd =
					innerIndex === node.children.length - 1 && offset >= displayLength(lastChild.raw);
				if (atEnd) return deps.listContext.insertItemAfter(index);

				return deps.listContext.splitItemAtOffset(index, innerIndex, offset);
			}
		}
	});
}
