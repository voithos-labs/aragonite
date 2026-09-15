/** The narrow commit interface `tree-operations/paste/` depends on instead of importing
 *  editor-actions. */

import type { PasteCommitCoordinator } from '../tree-operations/paste/paste-deps';
import type { EditorActionsDeps, UndoController } from './deps';
import { getStateForNode } from '../reactivity/state-registry';

export function createPasteCoordinator(
	controller: UndoController,
	revealPath: EditorActionsDeps['revealPath']
): PasteCommitCoordinator {
	return {
		commitMultiScope: controller.commitMultiScope,
		getDocScope: controller.getDocScope,
		// editor-actions may import reactivity and the reveal; handing them over here keeps
		// `tree-operations/paste/` from importing either itself.
		resolveState: getStateForNode,
		landCaret: async (path, offset) => {
			const stamp = controller.historyGeneration();
			const block = await revealPath(path);
			// An undo or redo that finished while the target was scrolling into view swapped
			// the tree, so this path no longer names what the paste aimed at.
			if (controller.historyGeneration() !== stamp) return;
			block?.focus(offset);
		}
	};
}
