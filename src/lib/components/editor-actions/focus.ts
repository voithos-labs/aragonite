/**
 * FocusActions factory: cursor movement across blocks, including
 * sticky-column-aware vertical traversal and trailing-paragraph creation
 * past the document end.
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
				// Past the last block — create a new empty paragraph via the
				// commit primitive so the append participates in undo history
				// and edit-event emission like every other structural mutation.
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
					// 0.5.5.4: dedicated appendBlock op kind expresses the intent
					// accurately. Subscribers that counted 'split' events before this
					// change saw appends contribute to their split count — the fix is
					// a behavior-visible correction to the event stream.
					{ op: { kind: 'appendBlock' } }
				);
				return;
			}
			const block = deps.blockRefs[blockIndex];
			if (!block?.focusable) return;

			if (typeof position === 'object' && 'stickyColumnFrom' in position) {
				// Sticky-column variant: dispatch to focusAtColumn? if available,
				// else fall back to focus(0) / focus(CURSOR_END) based on direction.
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
				// 'end' — use a large number, focus() should clamp to content length
				block.focus(CURSOR_END);
			}
		}
	};
}
