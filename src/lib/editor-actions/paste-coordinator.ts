/** Lets paste modules depend on a narrow interface in their own layer instead of reaching up into editor-actions. */

import type { PasteCommitCoordinator } from '../tree-operations/paste/paste-deps';
import type { UndoController } from './deps';
import { expectStateForNode, getStateForNode } from '../reactivity/state-registry';

export function createPasteCoordinator(controller: UndoController): PasteCommitCoordinator {
	return {
		sharing: controller.sharing,
		commitMultiScope: controller.commitMultiScope,
		getDocScope: controller.getDocScope,
		// editor-actions may read reactivity (downward edge); supplying these here
		// keeps `tree-operations/paste/` from importing the registry itself.
		resolveState: getStateForNode,
		expectState: expectStateForNode
	};
}
