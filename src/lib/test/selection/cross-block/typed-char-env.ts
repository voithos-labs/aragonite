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
import { defaultGrammarView, type GrammarView } from '$lib/schema/block-openers';
import type { SelectionState } from '$lib/selection/selection-state.svelte';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { fixtureLinkRef } from '../../harness/fixture-grammar';

/** Override focus to vi.fn() so cross-block dispatch tests can assert calls. */
const makeRef = (): BlockComponent => mockRef({ focus: vi.fn() });

export function makeEnv(source: string) {
	const doc = parse(source);
	let blockIds = doc.children.map((_, i) => `id-${i}`);
	let blockRefs: (BlockComponent | undefined)[] = doc.children.map(() => makeRef());
	const events = createEditorEvents();
	// Document-aware, as the shell's own state is: without it the endpoint normalizers measure
	// nothing and a whole-block endpoint pair stores a zero-length span.
	const selectionState = createSelectionState({ getDoc: () => doc });
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
		// This env asserts on selection, never on the content version; the version-writer scan
		// owns that question.
		bumpContentVersion: () => {},
		undoManager: createUndoManager(),
		sharing: createSharingState(),
		stickyColumn,
		edgeAffinity,
		selectionState,
		getBlockElByPath: () => null,
		revealPath: async (path: number[]) => (path.length === 1 ? (blockRefs[path[0]] ?? null) : null),
		events,
		grammar: defaultGrammarView,
		linkRef: fixtureLinkRef()
	};
	const controller = createUndoController(deps);
	const blockEdit = createBlockEditActions(deps, controller);
	return { doc, deps, events, selectionState, controller, blockEdit, stickyColumn, edgeAffinity };
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
