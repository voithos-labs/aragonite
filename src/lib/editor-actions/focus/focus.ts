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
import { dispatchMoveFocus, type MoveFocusScope } from './focus-dispatch';
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

	/** Past the last block a move appends a paragraph (outside reading mode); before the first
	 *  it stops. */
	async function leave(
		step: -1 | 1,
		_position: FocusPosition,
		options?: MoveFocusOptions
	): Promise<void> {
		// Reading mode writes nothing, so a move past the last block just stops there.
		if (step < 0 || options?.append === false || isReadingMode(deps.reading.mode)) return;
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
	}

	const scope: MoveFocusScope = {
		count: () => deps.doc.children.length,
		mount: (index) => deps.revealPath([index]),
		leave,
		// A directional move crosses the boundary at the greater adjacent index. `gapEligibleAt`
		// declines out-of-range boundaries and the root's trailing one.
		gapStop: (boundaryIndex) => gapStopAt([], boundaryIndex)
	};

	return {
		revealPath: deps.revealPath,
		tryGapStop: gapStopAt,
		moveFocus: (blockIndex: number, position: FocusPosition, options?: MoveFocusOptions) =>
			dispatchMoveFocus(scope, blockIndex, position, deps.caretMemory, options)
	};
}
