/**
 * The context wiring every editable-block component threads identically: one init-time bundle
 * of the shared `EditableSurfaceDeps` fields, plus chord dispatch built over the same gates and
 * the shared focus-park teardown. Call during component init — `getContext` requires it, and
 * `createEditableSurface` itself stays context-free (the jsdom harness constructs it bare).
 */

import { getContext } from 'svelte';
import type { BlockEditActions, FocusActions, HistoryActions } from '../../action-contracts';
import {
	BLOCK_EDIT_KEY,
	EDITOR_DOC_KEY,
	EDITOR_POLICIES_KEY,
	EDITOR_SERVICES_KEY,
	FOCUS_KEY,
	HISTORY_KEY,
	type EditorDoc,
	type EditorPolicies,
	type EditorServices
} from '../../editor-keys';
import { emitCommandError } from '../../editor-events';
import { eventToChord } from '../../schema/keybindings';
import { dispatchKeyCommand, type KindCommandTarget } from '../../schema/block-commands';
import { parkFocusOnEditorRoot } from '../../selection/native-bridge';
import type { EditableSurfaceDeps } from './editable-surface';

/** The context-threaded half of `EditableSurfaceDeps` — the fields every surface passes verbatim. */
export type SharedSurfaceDeps = Pick<
	EditableSurfaceDeps,
	| 'selection'
	| 'getDoc'
	| 'getBlockElByPath'
	| 'focusActions'
	| 'getEditorRoot'
	| 'getScrollHost'
	| 'getEditorLifetime'
	| 'stickyColumn'
	| 'edgeAffinity'
	| 'blockEdit'
	| 'controller'
	| 'history'
	| 'pluginEditor'
	| 'getKeybindingOverrides'
	| 'pasteCoordinator'
	| 'grammar'
	| 'activePlugins'
	| 'events'
	| 'linkRef'
	| 'onCommandError'
	| 'crossBlockCommands'
>;

export interface SurfaceWiring {
	/** Spread first into `createEditableSurface`; per-surface fields follow and may override. */
	deps: SharedSurfaceDeps;
	/** Resolve a chord at `target` through the shared gates; consumes the event when spent. */
	dispatchChord(e: KeyboardEvent, target: KindCommandTarget): boolean;
}

export function wireSurfaceContexts(): SurfaceWiring {
	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const {
		controller,
		pasteCoordinator,
		stickyColumn,
		edgeAffinity,
		selection,
		registryView,
		activePlugins,
		events,
		crossBlockCommands
	} = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const { keybindingOverrides, presentationMode: getPresentationMode } =
		getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const {
		blockElLookup: getBlockElByPath,
		doc: getDoc,
		editorRoot: getEditorRoot,
		scrollHost: getScrollHost,
		lifetime: editorLifetime,
		pluginEditor,
		linkRef
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);

	const deps: SharedSurfaceDeps = {
		selection,
		getDoc,
		getBlockElByPath,
		focusActions,
		getEditorRoot,
		getScrollHost,
		getEditorLifetime: () => editorLifetime ?? null,
		stickyColumn,
		edgeAffinity,
		blockEdit,
		controller,
		history,
		pluginEditor,
		getKeybindingOverrides: keybindingOverrides,
		pasteCoordinator,
		grammar: registryView.grammar,
		activePlugins,
		events,
		linkRef,
		crossBlockCommands,
		onCommandError: (report) => emitCommandError(events, report)
	};

	const dispatchChord = (e: KeyboardEvent, target: KindCommandTarget): boolean => {
		const chord = eventToChord(e);
		if (
			!chord ||
			!dispatchKeyCommand(
				chord,
				target,
				{
					history,
					pluginEditor,
					getPresentationMode,
					isCrossBlockRange: () => selection.isCrossBlock,
					crossBlockCommands: crossBlockCommands
				},
				keybindingOverrides(),
				deps.onCommandError
			)
		) {
			return false;
		}
		e.preventDefault();
		return true;
	};

	return { deps, dispatchChord };
}

// Windowed out while focused: hand focus to the editor root so the next keystroke
// routes through its document-level listener instead of falling to `<body>`.
export function useParkFocusOnUnmount(
	getEl: () => HTMLElement | null,
	getEditorRoot: () => HTMLElement | null
): void {
	$effect(() => {
		const blockEl = getEl();
		return () => parkFocusOnEditorRoot(blockEl, getEditorRoot());
	});
}
