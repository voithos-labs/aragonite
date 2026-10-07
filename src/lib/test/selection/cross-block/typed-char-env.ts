// Driving a typed character against a live cross-block selection through the real dispatch:
// document, undo controller and selection are all real, so the survivor's kind, bytes and caret
// are the tree's own answers rather than a spy's.

import { createCrossBlockHandlers } from '$lib/selection/cross-block/dispatch';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { type GrammarView } from '$lib/schema/block-openers';
import type { SelectionState } from '$lib/selection/selection-state.svelte';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { fixtureReading } from '../../harness/fixture-grammar';
import type { Reading } from '$lib/schema/reading';
import { commandContext } from '../../support/command-context';

/** `reading` is the editor's own, which every write reads off the root. */
export function makeEnv(source: string, reading?: Reading) {
	const { deps, doc, events, landings } = makeEditorActionsDeps(source, { reading });
	const controller = createUndoController(deps);
	const blockEdit = createBlockEditActions(deps, controller);
	return {
		doc,
		deps,
		events,
		landings,
		selectionState: deps.selectionState,
		controller,
		blockEdit,
		caretMemory: deps.caretMemory
	};
}

export interface HandlerOptions {
	/** Instance grammar the dispatch must forward onto its commit contexts. */
	grammar?: GrammarView;
}

export function makeHandlers(
	env: ReturnType<typeof makeEnv>,
	myPath: number[],
	opts: HandlerOptions = {}
) {
	const stubEl = document.createElement('div');
	return createCrossBlockHandlers({
		getEl: () => stubEl,
		getMyPath: () => myPath,
		selection: env.selectionState,
		getDoc: () => env.doc,
		getBlockElByPath: () => null,
		caretLanding: env.deps.caretLanding,
		getEditorRoot: () => null,
		getScrollHost: () => null,
		scrollOwner: { place: () => ({ scroll: async () => true }) },
		getEditorLifetime: () => null,
		caretMemory: env.caretMemory,
		blockEdit: env.blockEdit,
		controller: env.controller,
		// The env's own mode, so a reading-mode env's dispatch and commits agree.
		reading: fixtureReading(opts.grammar ? { grammar: opts.grammar } : {}, env.deps.reading.mode()),
		commands: commandContext({ isCrossBlockRange: () => env.selectionState.isCrossBlock }),
		pasteCoordinator: createPasteCoordinator(env.deps, env.controller),
		activePlugins: everyInstalledPlugin,
		events: env.events
	});
}

export function selectAcross(selection: SelectionState, anchor: number[], focus: number[]): void {
	selection.enterCrossBlock({ path: anchor, offset: 0 }, { path: focus, offset: 0 });
}

export function makeBeforeInputEvent(typed: string): InputEvent {
	return new (window as unknown as { InputEvent: typeof InputEvent }).InputEvent('beforeinput', {
		inputType: 'insertText',
		data: typed,
		cancelable: true
	});
}

export function makePasteEvent(text: string): ClipboardEvent {
	return {
		clipboardData: { getData: () => text },
		preventDefault: () => {}
	} as unknown as ClipboardEvent;
}
