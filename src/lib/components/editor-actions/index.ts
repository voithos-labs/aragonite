/**
 * Editor-root action bundle factory. Composes the undo controller plus four
 * sub-interface bundles for Editor.svelte to wire into Svelte context.
 */

import type { EditorActionsDeps, UndoController } from './deps';
import type {
	BlockEditActions,
	FocusActions,
	HistoryActions,
	ContainerEditActions,
	UndoEntry
} from '../../contracts';
import { createUndoController } from './undo-controller';
import { createBlockEditActions } from './block-edit';
import { createFocusActions } from './focus';
import { createHistoryActions } from './history';
import { createContainerEditActions } from './container-edit';

export interface EditorActionsBundle {
	blockEdit: BlockEditActions;
	focus: FocusActions;
	history: HistoryActions;
	containerEdit: ContainerEditActions;
	captureCurrentState(): UndoEntry;
	controller: UndoController;
}

export function createEditorActions(deps: EditorActionsDeps): EditorActionsBundle {
	const controller = createUndoController(deps);
	return {
		blockEdit: createBlockEditActions(deps, controller),
		focus: createFocusActions(deps, controller),
		history: createHistoryActions(deps, controller),
		containerEdit: createContainerEditActions(deps, controller),
		captureCurrentState: controller.captureCurrentState,
		controller
	};
}

export type { EditorActionsDeps, MultiScopeTarget, MultiScopeMutable } from './deps';
