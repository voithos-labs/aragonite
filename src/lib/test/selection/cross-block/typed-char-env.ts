// Driving a typed character against a live cross-block selection through the real dispatch:
// document, undo controller and selection are all real, so the survivor's kind, bytes and caret
// are the tree's own answers rather than a spy's.

import { vi } from 'vitest';
import { createCrossBlockHandlers } from '$lib/selection/cross-block/dispatch';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createUndoManager } from '$lib/undo/manager';
import { createSharingState } from '$lib/tree-operations/sharing';
import { createEditorEvents } from '$lib/editor-events';
import { refSlotsOver } from '$lib/reactivity/publish-ref.svelte';
import { parse } from '$lib/core/parser';
import { mockRef, makeStickyColumn, makeEdgeAffinity } from '$lib/test/harness/editor-actions';
import type { BlockComponent } from '$lib/block-component';
import type { SelectionState } from '$lib/selection/selection-state.svelte';

/** Override focus to vi.fn() so cross-block dispatch tests can assert calls. */
export const makeRef = (): BlockComponent => mockRef({ focus: vi.fn() });

export function makeEnv(source: string) {
	const doc = parse(source);
	let blockIds = doc.children.map((_, i) => `id-${i}`);
	let blockRefs: (BlockComponent | undefined)[] = doc.children.map(() => makeRef());
	const events = createEditorEvents();
	const selectionState = createSelectionState();
	const stickyColumn = makeStickyColumn();
	const edgeAffinity = makeEdgeAffinity();
	const deps = {
		get doc() {
			return doc;
		},
		get blockIds() {
			return blockIds;
		},
		get blockRefs() {
			return blockRefs;
		},
		blockRefSlots: refSlotsOver(blockRefs),
		setDoc: () => {},
		setBlockIds: (v: string[]) => {
			blockIds = v;
		},
		setBlockRefs: (v: (BlockComponent | undefined)[]) => {
			blockRefs = v;
		},
		// This env asserts on selection, never on the version; the door census owns that question.
		bumpContentVersion: () => {},
		undoManager: createUndoManager(),
		sharing: createSharingState(),
		stickyColumn,
		edgeAffinity,
		selectionState,
		getBlockElByPath: () => null,
		revealPath: async (path: number[]) => (path.length === 1 ? (blockRefs[path[0]] ?? null) : null),
		events
	};
	const controller = createUndoController(deps);
	const blockEdit = createBlockEditActions(deps, controller);
	return { doc, deps, events, selectionState, controller, blockEdit, stickyColumn, edgeAffinity };
}

export interface HandlerOptions {
	getCursorOffset?: () => number | null;
	/** The caret-landing door: the dispatch places its post-commit caret through this. */
	getBlockElByPath?: (path: number[]) => HTMLElement | null;
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
		revealPath: env.deps.revealPath,
		getEditorRoot: () => null,
		getScrollHost: () => null,
		getEditorLifetime: () => null,
		stickyColumn: env.stickyColumn,
		edgeAffinity: env.edgeAffinity,
		blockEdit: env.blockEdit,
		controller: env.controller,
		history: { requestUndo() {}, requestRedo() {} },
		pluginEditor: undefined,
		getPresentationMode: () => 'source' as const,
		linkRef: undefined,
		onCommandError: undefined,
		getKeybindingOverrides: () => normalizeKeybindingOverrides(undefined),
		pasteCoordinator: createPasteCoordinator(env.controller, env.deps.revealPath),
		grammar: undefined,
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
