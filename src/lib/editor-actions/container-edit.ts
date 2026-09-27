/**
 * The root ContainerEditActions: what a container reaches the editor root for, which is the
 * document's line ending, the container commit and the keystroke's two routes.
 */

import type { ContainerEditActions } from '../action-contracts';
import { documentLineEnding } from '../core/lines';
import type { EditorActionsDeps, UndoController } from './deps';
import { createLeafTyping } from './leaf-write';

export function createContainerEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): ContainerEditActions {
	const { typeInLeaf, writeLeafInPlace } = createLeafTyping(deps, controller);
	return {
		lineEnding: () => documentLineEnding(deps.doc),
		commitContainer: (args) => controller.commitContainerStructural(args),
		typeInLeaf,
		writeLeafInPlace
	};
}
