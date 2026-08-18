/**
 * Override factory every plugin-seam container shares: the Enter-on-empty-last-child exit.
 * Backspace unwrap (U2) is declaration-driven — the kind's `unwrapRole` selects strategies
 * in `unwrap-strategies.ts`.
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
			// Enter on an empty trailing paragraph exits the container instead of appending another
			// inner line, and MINTS the blank it lands on: Enter is never down-nav, so a block
			// below is left alone and a nested container is escaped one level per press.
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
