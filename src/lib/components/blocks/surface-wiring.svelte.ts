/**
 * The context wiring every editable-block component shares: the common `EditableSurfaceDeps`
 * fields, chord dispatch through the editor's command context, and the focus-away teardown.
 * Call it during component init, since it reads `getContext`.
 */

import { getContext } from 'svelte';
import type { BlockEditActions, FocusActions, HistoryActions } from '../../action-contracts';
import {
	BLOCK_EDIT_KEY,
	EDITOR_DOC_KEY,
	EDITOR_SERVICES_KEY,
	FOCUS_KEY,
	HISTORY_KEY,
	type EditorDoc,
	type EditorServices
} from '../../editor-keys';
import { eventToChord } from '../../schema/keybindings';
import { dispatchKeyCommand, type KindCommandTarget } from '../../schema/block-commands';
import { commandForKey } from '../../schema/commands';
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
	| 'caretLanding'
	| 'getEditorRoot'
	| 'getScrollHost'
	| 'getEditorLifetime'
	| 'caretMemory'
	| 'blockEdit'
	| 'controller'
	| 'history'
	| 'pasteCoordinator'
	| 'activePlugins'
	| 'events'
	| 'selectedWidget'
	| 'reading'
	| 'commands'
>;

export interface SurfaceWiring {
	/** Spread first into `createEditableSurface`; per-block fields follow and may override. */
	deps: SharedSurfaceDeps;
	/** Resolve a chord at `target` through the editor's command context; consumes a handled event. */
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
		caretLanding,
		pasteCoordinator,
		caretMemory,
		selection,
		activePlugins,
		events,
		commands,
		selectedWidget
	} = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const {
		blockElLookup: getBlockElByPath,
		doc: getDoc,
		editorRoot: getEditorRoot,
		scrollHost: getScrollHost,
		lifetime: editorLifetime,
		reading
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);

	const deps: SharedSurfaceDeps = {
		selection,
		getDoc,
		getBlockElByPath,
		focusActions,
		caretLanding,
		getEditorRoot,
		getScrollHost,
		getEditorLifetime: () => editorLifetime ?? null,
		caretMemory,
		blockEdit,
		controller,
		history,
		pasteCoordinator,
		activePlugins,
		events,
		selectedWidget,
		reading,
		commands
	};

	const dispatchChord = (e: KeyboardEvent, target: KindCommandTarget): boolean => {
		const chord = eventToChord(e);
		if (!chord || !dispatchKeyCommand(chord, target, commands)) return false;
		e.preventDefault();
		return true;
	};

	const resolveChord = (e: KeyboardEvent, kind: AnyBlockKind): AnyCommandId | null =>
		commandForKey(e, kind, commands);

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
