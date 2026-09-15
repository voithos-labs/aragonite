/**
 * ListBlock's overrides: item-level no-ops and the last item's forward merge, handed to the
 * parent. Item delete and replace fall through to the shared block-edit core. Backspace
 * unwrap (rules U1 and M1) comes from the list's declared `unwrapRole`, which picks a
 * strategy in `unwrap-strategies.ts`.
 */

import type { BlockEditActions } from '../action-contracts';
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
