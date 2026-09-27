/**
 * The root FocusActions: caret movement across top-level blocks, vertical moves that keep
 * the sticky column, and the paragraph appended when a move goes past the document's end
 * (outside reading mode).
 */

import type { FocusActions, MoveFocusOptions } from '../../action-contracts';
import type { FocusPosition } from '../../block-component';
import type { EditorActionsDeps, UndoController } from '../deps';
import { emptyParagraph } from '../../tree-operations';
import { documentLineEnding } from '../../core/lines';
import { traversalStep } from './focus-dispatch';
import { consumeStickyLanding } from './focus-landing';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { tryGapStop, type GapStopScope } from '../../selection/gap-caret';
import { isReadingMode } from '../../presentation-mode';

export function createFocusActions(
	deps: EditorActionsDeps,
	controller: UndoController
): FocusActions {
	const gapScope: GapStopScope = {
		getDoc: () => deps.doc,
		selection: deps.selectionState,
		getPresentationMode: deps.reading.mode
	};
	const gapStopAt = (parentPath: number[], boundaryIndex: number) =>
		tryGapStop(gapScope, parentPath, boundaryIndex);

	return {
		revealPath: deps.revealPath,
		tryGapStop: gapStopAt,
		async moveFocus(
			blockIndex: number,
			position: FocusPosition,
			options?: MoveFocusOptions
		): Promise<void> {
			const step = traversalStep(position);
			const stopsAtGaps = step !== 0 && !options?.skipGapStop;
			// A directional move crosses the boundary at the greater adjacent index. `gapEligibleAt`
			// declines out-of-range boundaries and the root's trailing one, so no guard follows.
			if (stopsAtGaps && gapStopAt([], step > 0 ? blockIndex : blockIndex + 1)) return;
			if (blockIndex < 0) return;
			if (blockIndex >= deps.doc.children.length) {
				// Reading mode writes nothing, so a move past the last block just stops there.
				if (options?.append === false || isReadingMode(deps.reading.mode)) return;
				// Appended through a commit so it is in undo history and edit events; the blank line
				// and the paragraph's own line both take the document's line ending.
				const lineEnding = documentLineEnding(deps.doc);
				const newBlock = emptyParagraph(lineEnding, lineEnding);
				// The appended index (one past the end) is the path for both the event and the
				// undo restore fallback: it names the block this creates.
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
				// A block with no ref, or one that cannot take focus, must not stop the move: skip
				// it in the move's direction (`docs/design/editor.md` § Focus traversal).
				if (step !== 0) await this.moveFocus(blockIndex + step, position, options);
				return;
			}

			// Moving to a block's end is a jump, so each construct decides which side of a hidden
			// closer it means, or the next byte typed joins it (`docs/design/live-mode.md` § 4.2).
			if (position === 'end') deps.caretMemory.noteExtreme();

			await consumeStickyLanding(block, blockIndex, position, deps.caretMemory, (i) =>
				this.moveFocus(i, position, options)
			);
		}
	};
}
