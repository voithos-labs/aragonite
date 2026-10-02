// The context a range replace runs in, over a headless editor: every collaborator is the real one
// the editor wires, so a removal's bytes, undo entry and landing are the editor's own.

import type { EditorActionsDeps, UndoController } from '$lib/editor-actions/deps';
import type { CrossBlockMutationContext } from '$lib/selection/cross-block/range-replace';
import type { Reading } from '$lib/schema/reading';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { commandContext } from '../../support/command-context';

export function rangeContext(
	deps: EditorActionsDeps,
	controller: UndoController,
	reading: Reading = deps.reading
): CrossBlockMutationContext {
	return {
		selection: deps.selectionState,
		getDoc: () => deps.doc,
		controller,
		reading,
		caretLanding: deps.caretLanding,
		caretMemory: deps.caretMemory,
		events: deps.events,
		blockEdit: createBlockEditActions(deps, controller),
		pasteCoordinator: createPasteCoordinator(deps, controller),
		activePlugins: everyInstalledPlugin,
		commands: commandContext({ isCrossBlockRange: () => deps.selectionState.isCrossBlock })
	};
}
