/**
 * Override factory for ListBlock — list-wrapper-level structural overrides
 * that ListBlock layers over the standard nested actions bundle: item-level
 * no-ops and last-item forward-merge delegation. Item delete and item replace
 * fall through to the shared block-edit core (via the container scope), which
 * carries the noop-discard, focus-offset snapshot, and empty-container backfill
 * guards this override used to re-implement by hand. Backspace unwrap (U1/M1)
 * is declaration-driven — the list's `unwrapRole` selects strategies in
 * `unwrap-strategies.ts`.
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
			splitBlock: async (): Promise<void> => {},
			updateBlockContent: (): void => {},

			// Forward-delete is a no-op between items (structural peers, not text-mergeable).
			// For the LAST item, delegate upward so the following block merges into this list's deepest leaf.
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
