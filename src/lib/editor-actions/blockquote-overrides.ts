/**
 * Override factory for BlockquoteBlock: the Enter-on-empty-last-child exit.
 * Backspace unwrap (U2) is declaration-driven — the blockquote's `unwrapRole`
 * selects strategies in `unwrap-strategies.ts`.
 */

import type { BlockEditActions } from '../action-contracts';
import { displayLength } from '../core/lines';
import { buildQuoteExitReplacement } from '../tree-operations/blockquote';
import type { NestedActionsBundle, NodeScope } from './nested/nested-actions';

export interface BlockquoteOverridesDeps {
	scope: NodeScope;
	parentBlockEdit: BlockEditActions;
}

export function createBlockquoteOverrides(deps: BlockquoteOverridesDeps) {
	return (defaults: NestedActionsBundle) => ({
		blockEdit: {
			// Enter on an empty trailing paragraph exits the quote instead of appending another
			// inner line, and MINTS the blank it lands on: Enter is never down-nav, so a block
			// below is left alone and a nested quote is escaped one level per press.
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
