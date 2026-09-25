/**
 * The root FocusActions: caret movement across top-level blocks, vertical moves that keep
 * the sticky column, and the paragraph appended when a move goes past the document's end.
 */

import type { FocusActions, MoveFocusOptions } from '../../action-contracts';
import type { FocusPosition } from '../../block-component';
import type { EditorActionsDeps, UndoController } from '../deps';
import { emptyParagraph } from '../../tree-operations';
import { trailingLineEnding } from '../../core/lines';
import { traversalStep } from './focus-dispatch';
import { consumeStickyLanding } from './focus-landing';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { tryGapStop, type GapStopScope } from '../../selection/gap-caret';

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
			// The boundary a directional move crosses is the greater of the two adjacent
			// indices. `gapEligibleAt` declines out-of-range boundaries and the root's trailing
			// one, so the branches below need no guard of their own.
			if (stopsAtGaps && gapStopAt([], step > 0 ? blockIndex : blockIndex + 1)) return;
			if (blockIndex < 0) return;
			if (blockIndex >= deps.doc.children.length) {
				if (options?.append === false) return;
				// Past the last block: appended through a commit so it is in undo history and edit
				// events. The separating blank line and the paragraph's own line are both line
				// endings, so both take the document's (G4.20).
				const lastBlock = deps.doc.children[deps.doc.children.length - 1];
				const lineEnding = trailingLineEnding(lastBlock?.raw ?? '\n');
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
				// it in the move's direction (editor.md § Focus traversal).
				if (step !== 0) await this.moveFocus(blockIndex + step, position, options);
				return;
			}

			// Landing at a block's end is a jump to an extreme, not a step onto it, so which side
			// of a hidden marker it means is decided per construct (docs/design/live-mode.md
			// § 4.2). Without this the first byte typed after the move joins the closer.
			if (position === 'end') deps.edgeAffinity.noteExtreme();

			await consumeStickyLanding(block, blockIndex, position, deps.stickyColumn, (i) =>
				this.moveFocus(i, position, options)
			);
		}
	};
}
