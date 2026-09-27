/**
 * The override every plugin container shares: Enter on an empty last child exits the
 * container. Backspace unwrap comes from the kind's declared `unwrapRole`, which picks a
 * strategy in `unwrap-strategies.ts` (`docs/design/editor.md` § Container unwrap).
 */

import type { BlockEditActions } from '../action-contracts';
import { displayLength, isBlankText } from '../core/lines';
import { buildQuoteExitReplacement } from '../tree-operations/blockquote';
import type { NestedActionsBundle, NodeScope } from './nested/nested-actions';

export interface ContainerExitOverridesDeps {
	scope: NodeScope;
	parentBlockEdit: BlockEditActions;
}

export function createContainerExitOverrides(deps: ContainerExitOverridesDeps) {
	return (defaults: NestedActionsBundle) => ({
		blockEdit: {
			// Enter on an empty last paragraph exits onto a new blank paragraph after the container,
			// never into an existing block, so nested containers are escaped one level per Enter.
			splitBlock: async (innerIndex: number, offset: number): Promise<boolean> => {
				const { parentBlockEdit } = deps;
				const { node, index } = deps.scope;
				if (!node.children) return false;
				const child = node.children[innerIndex];
				const isLastChild = innerIndex === node.children.length - 1;
				const isEmpty = child.kind === 'paragraph' && isBlankText(child.raw);
				if (!isLastChild || !isEmpty) return defaults.blockEdit.splitBlock(innerIndex, offset);
				if (node.children.length <= 1) {
					return parentBlockEdit.splitBlock(index, displayLength(node.raw));
				}
				return parentBlockEdit.replaceBlock(index, buildQuoteExitReplacement(node), {
					replacementIndex: 1,
					offset: 0
				});
			}
		}
	});
}
