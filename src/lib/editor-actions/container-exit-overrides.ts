/**
 * The override every plugin container shares: Enter on an empty last child exits the
 * container, unless a selection's removal is what emptied it. Backspace unwrap comes from the
 * kind's declared `unwrapRole`, which picks a strategy in `unwrap-strategies.ts`
 * (`docs/design/structural-edits.md` § Container unwrap).
 */

import type { BlockEditActions } from '../action-contracts';
import { displayLength } from '../core/lines';
import { buildQuoteExitReplacement, exitsOnEnter } from '../tree-operations/blockquote';
import type { Reading } from '../schema/reading';
import type { NestedActionsBundle, NodeScope } from './nested/nested-actions';
import type { CommandRun } from '../schema/block-commands';

export interface ContainerExitOverridesDeps {
	scope: NodeScope;
	parentBlockEdit: BlockEditActions;
	reading: Reading;
}

export function createContainerExitOverrides(deps: ContainerExitOverridesDeps) {
	return (defaults: NestedActionsBundle) => ({
		blockEdit: {
			// Enter on an empty last paragraph exits onto a new blank paragraph after the container,
			// never into an existing block, so nested containers are escaped one level per Enter.
			splitBlock: async (
				innerIndex: number,
				offset: number,
				run?: CommandRun
			): Promise<boolean> => {
				const { parentBlockEdit } = deps;
				const { node, index } = deps.scope;
				if (!node.children) return false;
				if (run?.afterRemoval || !exitsOnEnter(node, innerIndex)) {
					return defaults.blockEdit.splitBlock(innerIndex, offset, run);
				}
				if (node.children.length <= 1) {
					return parentBlockEdit.splitBlock(index, displayLength(node.raw));
				}
				return parentBlockEdit.replaceBlock(
					index,
					buildQuoteExitReplacement(node, deps.reading.grammar),
					{
						replacementIndex: 1,
						offset: 0
					},
					// The caret sat in a child leaf, which an offset into the quote can't name; the
					// live read records it.
					{ snapshotOffset: 0 }
				);
			}
		}
	});
}
