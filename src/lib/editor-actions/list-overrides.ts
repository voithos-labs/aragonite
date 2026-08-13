/**
 * Override factory for ListBlock: item-level no-ops and last-item forward-merge
 * delegation. Item delete and replace fall through to the shared block-edit core.
 * Backspace unwrap (U1/M1) is declaration-driven — the list's `unwrapRole` selects
 * strategies in `unwrap-strategies.ts`.
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
			// Items split through the ITEM's own bundle; nothing calls the list's, and the shared
			// core would run a prose split on a `listItem` if anything ever did.
			splitBlock: async (): Promise<void> => {},
			updateBlockContent: (): void => {},

			// Items are structural peers, not text-mergeable. Only the LAST item delegates
			// upward, so the following block merges into this list's deepest leaf.
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
