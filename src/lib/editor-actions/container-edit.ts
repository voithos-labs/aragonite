/**
 * The root ContainerEditActions: what a container reaches the editor root for, which is the
 * document's line ending, the container commit, the two things a keystroke needs the root for
 * (its undo entry, and the write that keeps the leaf in place), and the caret
 * landing with the whole-document read a delete's caret needs.
 */

import type { ContainerEditActions } from '../action-contracts';
import { documentLineEnding } from '../core/lines';
import { emitCommitError } from '../editor-events';
import type { EditorActionsDeps, UndoController } from './deps';
import { survivorAfterRemoval } from '../selection/caret-target';

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
		survivorAfterRemoval: (removedPath, gesture) =>
			survivorAfterRemoval(deps.doc, removedPath, gesture),
		reportCommitError: (error, op, path) => emitCommitError(deps.events, { error, op, path })
	};
}
