/** Lets paste modules depend on a narrow interface in their own layer instead of reaching up into editor-actions. */

import type { PasteCommitCoordinator } from '../tree-operations/paste/paste-deps';
import type { UndoController } from './deps';

export function createPasteCoordinator(controller: UndoController): PasteCommitCoordinator {
	return {
		sharing: controller.sharing,
		commitMultiScope: controller.commitMultiScope,
		getDocScope: controller.getDocScope
	};
}
