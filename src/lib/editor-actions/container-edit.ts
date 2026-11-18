/**
 * The root ContainerEditActions: what a container reaches the editor root for, which is the
 * document's line ending, the container commit, the two things a keystroke needs the root for
 * (its undo entry, and the write that keeps the leaf in place), the caret landing, a block's
 * removal whole through the range-edit core, and where a key that joins nothing lands beside one.
 */

import type { ContainerEditActions } from '../action-contracts';
import { CURSOR_END, CURSOR_START } from '../block-component';
import { docPathFrom } from '../core/coordinate-spaces';
import type { Landing } from '../selection/primitives';
import type { GapCaretSelection } from '../selection/gap-caret';
import { documentLineEnding } from '../core/lines';
import { emitCommitError } from '../editor-events';
import type { EditorActionsDeps, UndoController } from './deps';
import { placeBeside, removeWholeBlock } from '../selection/cross-block/range-removal';
import { keyLandingAt } from './commit/byte-splice';

/** Where a key that joins nothing lands beside the block at `path` (`ContainerEditActions.beside`). */
export function landingBeside(
	deps: Pick<EditorActionsDeps, 'bytes' | 'reading'>,
	path: readonly number[],
	dir: -1 | 1
): Landing | GapCaretSelection | null {
	const beside = placeBeside(deps, path, dir);
	const landed = beside && keyLandingAt(beside.measured, beside.place);
	if (landed) return landed;
	// A neighbour whose only text place is the document's open last line has no byte for the core
	// to name, so the caret enters it as any arrival does.
	const neighbour = docPathFrom([...path.slice(0, -1), path.at(-1)! + dir]);
	return { path: neighbour, offset: dir < 0 ? CURSOR_END : CURSOR_START };
}

export function createContainerEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): ContainerEditActions {
	return {
		lineEnding: () => documentLineEnding(deps.doc),
		commitContainer: (args) => controller.commitContainerStructural(args),
		typingKeystroke: (leafPath, preEditOffset, batchKey, history, work) =>
			controller.typingKeystroke(leafPath, preEditOffset, batchKey, history, work),
		typeLeaf: (leafPath, write, caret) => controller.typeLeaf(leafPath, write, caret),
		land: (pos) => deps.caretLanding.land(pos),
		removeWhole: (path, gesture, commit) =>
			removeWholeBlock(
				{ bytes: deps.bytes, reading: deps.reading, controller },
				path,
				gesture,
				commit
			),
		beside: (path, dir) => landingBeside(deps, path, dir),
		reportCommitError: (error, op, path) => emitCommitError(deps.events, { error, op, path })
	};
}
