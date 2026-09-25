// Driving a typed character against a live cross-block selection through the real dispatch:
// document, undo controller and selection are all real, so the survivor's kind, bytes and caret
// are the tree's own answers rather than a spy's.

import { createCrossBlockHandlers } from '$lib/selection/cross-block/dispatch';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import type { BlockComponent } from '$lib/block-component';
import { defaultGrammarView, type GrammarView } from '$lib/schema/block-openers';
import type { SelectionState } from '$lib/selection/selection-state.svelte';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { fixtureLinkRef } from '../../harness/fixture-grammar';

export function makeEnv(source: string) {
	const { deps, doc, events } = makeEditorActionsDeps(source);
	const controller = createUndoController(deps);
	const blockEdit = createBlockEditActions(deps, controller);
	return {
		doc,
		deps,
		events,
		selectionState: deps.selectionState,
		controller,
		blockEdit,
		stickyColumn: deps.stickyColumn,
		edgeAffinity: deps.edgeAffinity
	};
}

export interface HandlerOptions {
	getCursorOffset?: () => number | null;
	/** The caret's element lookup: the dispatch places its post-commit caret through this. */
	getBlockElByPath?: (path: number[]) => HTMLElement | null;
	/** Instance grammar the dispatch must forward onto its commit contexts. */
	grammar?: GrammarView;
	/** A substitute mount for the dispatch (held, for instance); the paste coordinator keeps the
	 *  env's own. */
	revealPath?: (path: number[]) => Promise<BlockComponent | null>;
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
		getIndex: () => myPath[0],
		selection: env.selectionState,
		getDoc: () => env.doc,
		getBlockElByPath: opts.getBlockElByPath ?? (() => null),
		revealPath: opts.revealPath ?? env.deps.revealPath,
		getEditorRoot: () => null,
		selectedWidget: { range: () => null, clear: () => {} },
		getScrollHost: () => null,
		getEditorLifetime: () => null,
		stickyColumn: env.stickyColumn,
		edgeAffinity: env.edgeAffinity,
		blockEdit: env.blockEdit,
		controller: env.controller,
		history: { requestUndo() {}, requestRedo() {} },
		pluginEditor: undefined,
		getPresentationMode: () => 'source' as const,
		linkRef: fixtureLinkRef(),
		onCommandError: undefined,
		crossBlockCommands: { canRun: () => false, run: () => false, isActive: () => false },
		getKeybindingOverrides: () => normalizeKeybindingOverrides(undefined),
		pasteCoordinator: createPasteCoordinator(env.controller, env.deps.revealPath),
		grammar: opts.grammar ?? defaultGrammarView,
		activePlugins: everyInstalledPlugin,
		events: env.events,
		getCursorOffset: opts.getCursorOffset ?? (() => 0),
		afterReactivity: async () => {}
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
