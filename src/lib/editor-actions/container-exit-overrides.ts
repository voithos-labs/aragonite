/**
 * The override every plugin container shares: Enter on an empty last child exits the
 * container. Backspace unwrap (rule U2) comes from the kind's declared `unwrapRole`, which
 * picks a strategy in `unwrap-strategies.ts`.
 */

import type { BlockEditActions } from '../action-contracts';
import { displayLength } from '../core/lines';
import { buildQuoteExitReplacement } from '../tree-operations/blockquote';
import type { NestedActionsBundle, NodeScope } from './nested/nested-actions';

export interface ContainerExitOverridesDeps {
	scope: NodeScope;
	parentBlockEdit: BlockEditActions;
}

export function createContainerExitOverrides(deps: ContainerExitOverridesDeps) {
	return (defaults: NestedActionsBundle) => ({
		blockEdit: {
			// Enter on an empty trailing paragraph exits the container instead of adding another
			// inner line, and creates the blank paragraph it lands on: Enter never moves down into
			// an existing block, and a nested container is escaped one level per Enter.
			splitBlock: async (innerIndex: number, offset: number): Promise<void> => {
				const { parentBlockEdit } = deps;
				const { node, index } = deps.scope;
				if (!node.children) return;
				const child = node.children[innerIndex];
				const isLastChild = innerIndex === node.children.length - 1;
				const isEmpty = child.kind === 'paragraph' && child.raw.trim() === '';
				if (isLastChild && isEmpty) {
					if (node.children.length <= 1) {
						await parentBlockEdit.splitBlock(index, displayLength(node.raw));
					} else {
						await parentBlockEdit.replaceBlock(index, buildQuoteExitReplacement(node), {
							replacementIndex: 1,
							offset: 0
						});
					}
					return;
				}
				return defaults.blockEdit.splitBlock(innerIndex, offset);
			}
		}
	});
}
