/**
 * FocusActions factory: cursor movement across blocks, sticky-column-aware
 * vertical traversal, and trailing-paragraph creation past document end.
 */

import type { FocusActions, MoveFocusOptions } from '../../action-contracts';
import type { FocusPosition } from '../../block-component';
import type { EditorActionsDeps, UndoController } from '../deps';
import { emptyParagraph } from '../../tree-operations';
import { trailingLineEnding } from '../../core/lines';
import { traversalStep } from './focus-dispatch';
import { consumeStickyLanding } from './focus-landing';
import { docPathFrom } from '../../cursor/coordinate-spaces';

export function createFocusActions(
	deps: EditorActionsDeps,
	controller: UndoController
): FocusActions {
	return {
		revealPath: deps.revealPath,
		async moveFocus(
			blockIndex: number,
			position: FocusPosition,
			options?: MoveFocusOptions
		): Promise<void> {
			if (blockIndex < 0) return;
			if (blockIndex >= deps.doc.children.length) {
				if (options?.append === false) return;
				// Past the last block — create a new empty paragraph via the commit
				// primitive so the append participates in undo history and edit
				// events like every other structural mutation. Both the separating
				// blank line and the paragraph's own line ARE line endings, so both
				// take the document's (G4.20), read off the block being appended after.
				const lastBlock = deps.doc.children[deps.doc.children.length - 1];
				const lineEnding = trailingLineEnding(lastBlock?.raw ?? '\n');
				const newBlock = emptyParagraph(lineEnding, lineEnding);
				// The appended slot (one past the end) is the coordinate for both the
				// event and the restore fallback — it names the block this op creates.
				const appendPath = docPathFrom([deps.doc.children.length]);
				await controller.commitStructural({
					snapshot: { path: appendPath, offset: 0 },
					mutate: (children) => {
						const at = children.length;
						children.push(newBlock);
						return { op: 'insert', at, count: 1 };
					},
					op: { kind: 'appendBlock', eventPath: appendPath },
					afterTick: () => {
						const lastIdx = deps.doc.children.length - 1;
						deps.blockRefs[lastIdx]?.focus(0);
					}
				});
				return;
			}
			const block = await deps.revealPath([blockIndex]);
			if (!block?.focusable) {
				// A refless (failed-render) or non-focusable block must not dead-end
				// the move — skip it in the move's direction (editor.md § Focus
				// Traversal). Recursion terminates at the doc edges above.
				const step = traversalStep(position);
				if (step !== 0) await this.moveFocus(blockIndex + step, position, options);
				return;
			}

			await consumeStickyLanding(block, blockIndex, position, deps.stickyColumn, (i) =>
				this.moveFocus(i, position, options)
			);
		}
	};
}
