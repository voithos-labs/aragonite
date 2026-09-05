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
import { tryGapStop, type GapStopScope } from '../../selection/gap-caret';

export function createFocusActions(
	deps: EditorActionsDeps,
	controller: UndoController
): FocusActions {
	const gapScope: GapStopScope = {
		getDoc: () => deps.doc,
		selection: deps.selectionState,
		getPresentationMode: deps.getPresentationMode
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
			// indices. Out-of-range boundaries and the root's trailing one decline in
			// `gapEligibleAt`, so the arms below keep their behavior unguarded.
			if (stopsAtGaps && gapStopAt([], step > 0 ? blockIndex : blockIndex + 1)) return;
			if (blockIndex < 0) return;
			if (blockIndex >= deps.doc.children.length) {
				if (options?.append === false) return;
				// Past the last block — appended through the commit primitive so it participates in
				// undo history and edit events. The separating blank line and the paragraph's own
				// are both line endings, so both take the document's (G4.20).
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
				// A refless or non-focusable block must not dead-end the move — skip it in
				// the move's direction (editor.md § Focus traversal).
				if (step !== 0) await this.moveFocus(blockIndex + step, position, options);
				return;
			}

			// A landing AT a block's end is a seat at an extreme, not a step onto it, so the side
			// it means is construct-relative (docs/design/live-mode.md § 4.2). Without this the
			// first byte typed after a structural landing joins the closer it landed inside.
			if (position === 'end') deps.edgeAffinity.noteExtreme();

			await consumeStickyLanding(block, blockIndex, position, deps.stickyColumn, (i) =>
				this.moveFocus(i, position, options)
			);
		}
	};
}
