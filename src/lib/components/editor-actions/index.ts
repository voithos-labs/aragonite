/**
 * Editor-root action bundles. Factory composes the undo controller plus
 * four sub-interface bundles, returning them as one object for Editor.svelte
 * to wire into the Svelte context.
 */

import type { EditorActionsDeps } from './deps';
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
}

export function createEditorActions(deps: EditorActionsDeps): EditorActionsBundle {
	const controller = createUndoController(deps);
	return {
		blockEdit: createBlockEditActions(deps, controller),
		focus: createFocusActions(deps, controller),
		history: createHistoryActions(deps, controller),
		containerEdit: createContainerEditActions(deps, controller),
		captureCurrentState: controller.captureCurrentState
	};
}

export type { EditorActionsDeps, MultiScopeTarget, MultiScopeMutable } from './deps';
