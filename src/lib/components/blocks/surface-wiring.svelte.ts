/**
 * The context wiring every editable-block component threads identically: one init-time bundle
 * of the shared `EditableSurfaceDeps` fields, plus chord dispatch built over the same gates and
 * the shared teardown that moves focus away. Call it during component init, since it reads
 * `getContext`; `createEditableSurface` itself stays context-free so the jsdom harness can build it.
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
import { resolveBinding } from '../../schema/commands';
import type { AnyBlockKind } from '../../core/nodes';
import type { AnyCommandId } from '../../schema/command-id';
import { parkFocusOnEditorRoot } from '../../selection/native-bridge';
import type { EditableSurfaceDeps } from './editable-surface';

/** The context half of `EditableSurfaceDeps`: the fields every block passes through unchanged. */
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
	| 'selectedWidget'
	| 'linkRef'
	| 'onCommandError'
	| 'crossBlockCommands'
>;

export interface SurfaceWiring {
	/** Spread first into `createEditableSurface`; per-surface fields follow and may override. */
	deps: SharedSurfaceDeps;
	/** Resolve a chord at `target` through the shared gates; consumes the event when spent. */
	dispatchChord(e: KeyboardEvent, target: KindCommandTarget): boolean;
	/** The command a keypress names at `kind`, overrides included, without running it. */
	resolveChord(e: KeyboardEvent, kind: AnyBlockKind): AnyCommandId | null;
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
		crossBlockCommands,
		selectedWidget
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
		selectedWidget,
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
					activation: activePlugins,
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

	const resolveChord = (e: KeyboardEvent, kind: AnyBlockKind): AnyCommandId | null => {
		const chord = eventToChord(e);
		if (!chord) return null;
		return resolveBinding(chord, kind, keybindingOverrides(), activePlugins)?.command ?? null;
	};

	return { deps, dispatchChord, resolveChord };
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
