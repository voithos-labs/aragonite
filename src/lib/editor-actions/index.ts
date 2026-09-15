/**
 * The editor root's action bundle: the undo controller plus the four action groups
 * Editor.svelte puts into Svelte context.
 */

import type {
	BlockEditActions,
	ContainerEditActions,
	FocusActions,
	HistoryActions
} from '../action-contracts';
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
	controller: UndoController;
}

export function createEditorActions(deps: EditorActionsDeps): EditorActionsBundle {
	const controller = createUndoController(deps);
	return {
		blockEdit: createBlockEditActions(deps, controller),
		focus: createFocusActions(deps, controller),
		history: createHistoryActions(deps, controller),
		containerEdit: createContainerEditActions(deps, controller),
		controller
	};
}

export type { EditorActionsDeps } from './deps';
