/**
 * The list's and the list item's overrides over the default child actions. The list's are
 * item-level no-ops and the last item's forward merge, handed to the parent; the item's is its
 * Enter. Backspace unwrap comes from the list's declared `unwrapRole`, which picks a strategy in
 * `unwrap-strategies.ts`.
 */

import type { BlockEditActions, ListContext } from '../action-contracts';
import { displayLength } from '../core/lines';
import type { NestedActionsOverrideFactory, NodeScope } from './nested/nested-actions';

export interface ListOverridesDeps {
	scope: NodeScope;
	parentBlockEdit: BlockEditActions;
}

export function createListOverrides(deps: ListOverridesDeps): NestedActionsOverrideFactory {
	return () => ({
		blockEdit: {
			// Items split through the item's own bundle; nothing calls the list's, and the shared
			// core would run a prose split on a `listItem` if anything ever did.
			splitBlock: async (): Promise<void> => {},
			updateBlockContent: (): void => {},

			// Items are structural peers, not text to merge. Only the last item hands the merge
			// to the parent, so the block after the list merges into the list's deepest leaf.
			mergeWithNext: async (itemIndex: number): Promise<void> => {
				const node = deps.scope.node;
				if (!node.children) return;
				if (itemIndex >= node.children.length - 1) {
					await deps.parentBlockEdit.mergeWithNext(deps.scope.index);
				}
			}
		}
	});
}

export interface ListItemOverridesDeps {
	scope: NodeScope;
	/** The enclosing list's context, read before the item provides its own. */
	listContext: ListContext;
}

/**
 * A list item's Enter: an empty item leaves the list, Enter at the item's end starts the next
 * item, and anywhere else splits the item in two. Backspace at an inner index of 0 or less is
 * the default already.
 */
export function createListItemOverrides(deps: ListItemOverridesDeps): NestedActionsOverrideFactory {
	return () => ({
		blockEdit: {
			splitBlock: async (innerIndex: number, offset: number): Promise<void> => {
				const { node, index } = deps.scope;
				if (!node.children) return;

				// Looser than `isItemUserEmpty`: trailing structural children stay until
				// `exitListAtItem` moves them.
				const firstChild = node.children[0];
				if (firstChild?.kind === 'paragraph' && firstChild.raw.trim() === '') {
					await deps.listContext.exitListAtItem(index);
					return;
				}

				const lastChild = node.children[node.children.length - 1];
				const atEnd =
					innerIndex === node.children.length - 1 && offset >= displayLength(lastChild.raw);
				if (atEnd) {
					await deps.listContext.insertItemAfter(index);
					return;
				}

				await deps.listContext.splitItemAtOffset(index, innerIndex, offset);
			}
		}
	});
}
