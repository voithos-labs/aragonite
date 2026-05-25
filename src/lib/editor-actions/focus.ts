/**
 * FocusActions factory: cursor movement across blocks, sticky-column-aware
 * vertical traversal, and trailing-paragraph creation past document end.
 */

import type { FocusActions } from '../action-contracts';
import { CURSOR_END, type FocusPosition } from '../block-component';
import type { CstNode } from '../core/nodes';
import type { EditorActionsDeps, UndoController } from './deps';

export function createFocusActions(
	deps: EditorActionsDeps,
	controller: UndoController
): FocusActions {
	return {
		async moveFocus(blockIndex: number, position: FocusPosition): Promise<void> {
			if (blockIndex < 0) return;
			if (blockIndex >= deps.doc.children.length) {
				// Past the last block — create a new empty paragraph via the commit
				// primitive so the append participates in undo history and edit
				// events like every other structural mutation.
				const newBlock: CstNode = { kind: 'paragraph', leadingTrivia: '\n', raw: '\n' };
				await controller.commitStructural({
					snapshot: { blockIndex: deps.doc.children.length, offset: 0 },
					mutate: (children) => {
						const at = children.length;
						children.push(newBlock);
						return { op: 'insert', at, count: 1 };
					},
					op: { kind: 'appendBlock' },
					afterTick: () => {
						const lastIdx = deps.doc.children.length - 1;
						deps.blockRefs[lastIdx]?.focus(0);
					}
				});
				return;
			}
			const block = deps.blockRefs[blockIndex];
			if (!block?.focusable) return;

			const isStickyMove = typeof position === 'object' && 'stickyColumnFrom' in position;

			if (isStickyMove && block.isVerticallyTransparent?.()) {
				const direction = position.stickyColumnFrom === 'below' ? -1 : 1;
				await this.moveFocus(blockIndex + direction, position);
				return;
			}

			if (position === 'start' && block.selectEdgeWidget?.('start')) return;
			if (position === 'end' && block.selectEdgeWidget?.('end')) return;

			if (isStickyMove) {
				const x = deps.stickyColumn.get();
				const from = position.stickyColumnFrom;
				if (x !== null && block.focusAtColumn) {
					block.focusAtColumn(x, from);
					return;
				}
				block.focus(from === 'above' ? 0 : CURSOR_END);
				return;
			}

			if (typeof position === 'number') {
				block.focus(position);
			} else if (position === 'start') {
				block.focus(0);
			} else {
				block.focus(CURSOR_END);
			}
		}
	};
}
