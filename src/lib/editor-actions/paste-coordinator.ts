/**
 * Implements `PasteCommitCoordinator` from tree-operations/paste/paste-deps.
 * Forwards to the full UndoController; lets paste modules depend on a narrow
 * interface in their own layer rather than reaching back up into editor-actions.
 */

import type { PasteCommitCoordinator } from '../tree-operations/paste/paste-deps';
import type { UndoController } from './deps';

export function createPasteCoordinator(controller: UndoController): PasteCommitCoordinator {
	return {
		commitMultiScope: controller.commitMultiScope.bind(controller),
		getDocScope: controller.getDocScope.bind(controller)
	};
}
