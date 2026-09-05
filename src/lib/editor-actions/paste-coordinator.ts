/** Lets paste modules depend on a narrow interface in their own layer instead of reaching up into editor-actions. */

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
		// editor-actions may read reactivity and reveal (downward edges); supplying
		// them here keeps `tree-operations/paste/` from importing either itself.
		resolveState: getStateForNode,
		landCaret: async (path, offset) => {
			const stamp = controller.historyGeneration();
			const block = await revealPath(path);
			// A history swap that resolved inside the reveal restored a different tree, so
			// this path no longer addresses what the paste aimed at.
			if (controller.historyGeneration() !== stamp) return;
			block?.focus(offset);
		}
	};
}
