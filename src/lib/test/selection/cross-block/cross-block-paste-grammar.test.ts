// @vitest-environment jsdom
//
// The cross-block paste caller (handleCrossBlockPaste) must forward the instance
// grammar onto the PasteDispatchContext it builds, so the join-paste reparse honors
// per-instance enablement. dispatch.test.ts proves the apply path honors a directly
// passed ctx.grammar; this proves the CALLER populates it from the dispatch context.
import { describe, it, expect } from 'vitest';
import { createCrossBlockHandlers } from '$lib/selection/cross-block/dispatch';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createUndoManager } from '$lib/undo/manager';
import { createSharingState } from '$lib/tree-operations/sharing';
import { createEditorEvents } from '$lib/editor-events';
import { parse } from '$lib/core/parser';
import { createGrammarView, type GrammarView } from '$lib/schema/block-openers';
import { mockRef, makeStickyColumn } from '$lib/test/harness/editor-actions';
import type { BlockComponent } from '$lib/block-component';

function makeEnv(source: string) {
	const doc = parse(source);
	let blockIds = doc.children.map((_, i) => `id-${i}`);
	let blockRefs: (BlockComponent | undefined)[] = doc.children.map(() => mockRef());
	const events = createEditorEvents();
	const selectionState = createSelectionState();
	const stickyColumn = makeStickyColumn();
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
		setDoc: () => {},
		setBlockIds: (v: string[]) => {
			blockIds = v;
		},
		setBlockRefs: (v: (BlockComponent | undefined)[]) => {
			blockRefs = v;
		},
		undoManager: createUndoManager(),
		sharing: createSharingState(),
		stickyColumn,
		selectionState,
		getBlockElByPath: () => null,
		revealPath: async (path: number[]) => (path.length === 1 ? (blockRefs[path[0]] ?? null) : null),
		events
	};
	const controller = createUndoController(deps);
	const blockEdit = createBlockEditActions(deps, controller);
	return {
		doc: () => deps.doc,
		deps,
		selectionState,
		controller,
		blockEdit,
		stickyColumn
	};
}

function makeHandlers(env: ReturnType<typeof makeEnv>, grammar: GrammarView | undefined) {
	const stubEl = document.createElement('div');
	return createCrossBlockHandlers({
		getEl: () => stubEl,
		getMyPath: () => [0],
		getIndex: () => 0,
		selection: env.selectionState,
		getDoc: env.doc,
		getBlockElByPath: () => null,
		revealPath: env.deps.revealPath,
		getEditorRoot: () => null,
		getEditorLifetime: () => null,
		stickyColumn: env.stickyColumn,
		blockEdit: env.blockEdit,
		controller: env.controller,
		history: { requestUndo() {}, requestRedo() {} },
		pluginEditor: undefined,
		getPresentationMode: () => 'source' as const,
		onCommandError: undefined,
		getKeybindingOverrides: () => normalizeKeybindingOverrides(undefined),
		pasteCoordinator: createPasteCoordinator(env.controller),
		grammar,
		getCursorOffset: () => 0,
		afterReactivity: async () => {}
	});
}

function pasteEvent(text: string): ClipboardEvent {
	return {
		clipboardData: { getData: () => text },
		preventDefault: () => {}
	} as unknown as ClipboardEvent;
}

// A cross-block paste whose collapsed caret lands at offset 0 of a `. item` block:
// pasting `1` completes the ordered-list marker to `1. item`. The join reparse must
// resolve through the instance grammar carried on the dispatch context.
describe('handleCrossBlockPaste forwards the instance grammar to the join reparse', () => {
	it('a grammar that disables the list opener leaves the completion a paragraph', async () => {
		const env = makeEnv('x\n\n. item\n');
		env.selectionState.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 0 });

		const handlers = makeHandlers(
			env,
			createGrammarView((kind) => kind !== 'list')
		);
		await handlers.handlePaste(pasteEvent('1'));

		expect(env.doc().children).toHaveLength(1);
		expect(env.doc().children[0].raw.trimEnd()).toBe('1. item');
		expect(env.doc().children[0].kind).toBe('paragraph');
	});

	// Control: with the global grammar (grammar undefined) the same paste re-mints the
	// list, so the assertion above is a real grammar effect, not a vacuous pass.
	it('the global grammar still re-mints the completion as a list', async () => {
		const env = makeEnv('x\n\n. item\n');
		env.selectionState.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 0 });

		const handlers = makeHandlers(env, undefined);
		await handlers.handlePaste(pasteEvent('1'));

		expect(env.doc().children[0].raw.trimEnd()).toBe('1. item');
		expect(env.doc().children[0].kind).toBe('list');
	});
});
