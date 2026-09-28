/**
 * The root ContainerEditActions: what a container reaches the editor root for, which is the
 * document's line ending, the container commit, the two things a keystroke needs the root for
 * (grouping it with its typing burst, and the write that keeps the leaf in place), and the caret
 * landing with the whole-document read a delete's caret needs.
 */

import type { ContainerEditActions } from '../action-contracts';
import { documentLineEnding } from '../core/lines';
import type { EditorActionsDeps, UndoController } from './deps';
import { createLeafTyping } from './leaf-write';
import { survivorAfterRemoval } from '../selection/caret-target';

export function createContainerEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): ContainerEditActions {
	const { typeInLeaf, writeLeafInPlace } = createLeafTyping(deps, controller);
	return {
		lineEnding: () => documentLineEnding(deps.doc),
		commitContainer: (args) => controller.commitContainerStructural(args),
		typeInLeaf,
		writeLeafInPlace,
		land: (pos) => deps.caretLanding.land(pos),
		survivorAfterRemoval: (removedPath, gesture) =>
			survivorAfterRemoval(deps.doc, removedPath, gesture)
	};
}
