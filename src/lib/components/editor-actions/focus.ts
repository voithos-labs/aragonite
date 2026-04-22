/**
 * FocusActions factory: cursor movement across blocks, sticky-column-aware
 * vertical traversal, and trailing-paragraph creation past document end.
 */

import { CURSOR_END, type FocusActions, type FocusPosition, type CstNode } from '../../contracts';
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
				await controller.commitStructural(
					deps.doc.children.length,
					0,
					(children) => {
						const at = children.length;
						children.push(newBlock);
						return { op: 'insert', at, count: 1 };
					},
					() => {
						const lastIdx = deps.doc.children.length - 1;
						deps.blockRefs[lastIdx]?.focus(0);
					},
					{ op: { kind: 'appendBlock' } }
				);
				return;
			}
			const block = deps.blockRefs[blockIndex];
			if (!block?.focusable) return;

			if (typeof position === 'object' && 'stickyColumnFrom' in position) {
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
