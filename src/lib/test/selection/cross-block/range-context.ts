// The context a range replace runs in, over a headless editor: every collaborator is the real one
// the editor wires, so a removal's bytes, undo entry and landing are the editor's own.

import type { EditorActionsDeps, UndoController } from '#lib/editor-actions/deps.js';
import type { CrossBlockMutationContext } from '#lib/selection/cross-block/range-replace.js';
import type { Reading } from '#lib/schema/reading.js';
import { parse } from '#lib/core/parser.js';
import { createBlockEditActions } from '#lib/editor-actions/block-edit.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createHistoryActions } from '#lib/editor-actions/commit/history.js';
import { createPasteCoordinator } from '#lib/editor-actions/paste-coordinator.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { makeEditorActionsDeps } from '../../harness/editor-actions';
import { fixtureReading } from '../../harness/fixture-grammar';
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

/** A headless editor over `source` with its range context and history. `liveSelection` reads the
 *  document as the editor's selection state does, which snaps table endpoints and whole rows. */
export function makeRangeEnv(source: string, opts: { liveSelection?: boolean } = {}) {
	const harness = makeEditorActionsDeps(parse(source).children);
	if (opts.liveSelection) {
		harness.deps.selectionState = createSelectionState({ getDoc: () => harness.deps.doc });
	}
	const controller = createUndoController(harness.deps);
	return {
		...harness,
		controller,
		mutCtx: rangeContext(harness.deps, controller, fixtureReading()),
		history: createHistoryActions(harness.deps, controller)
	};
}
