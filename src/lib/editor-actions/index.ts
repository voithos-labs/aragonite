/**
 * Editor-root action bundle factory. Composes the undo controller plus four
 * sub-interface bundles for Editor.svelte to wire into Svelte context.
 */

import type {
	BlockEditActions,
	ContainerEditActions,
	FocusActions,
	HistoryActions
} from '../action-contracts';
import type { UndoEntry } from '../undo/types';
import type { EditorActionsDeps, UndoController } from './deps';
import { createUndoController } from './commit/undo-controller';
import { createBlockEditActions } from './block-edit';
import { createFocusActions } from './focus/focus';
import { createHistoryActions } from './commit/history';
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

export type { ContainerScope, EditorActionsDeps, MultiScopeTarget } from './deps';
