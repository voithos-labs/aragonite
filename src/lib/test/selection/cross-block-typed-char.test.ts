// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
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
import { mockRef, makeStickyColumn } from '$lib/test/harness/editor-actions';
import type { BlockComponent } from '$lib/block-component';
import type { CstNode } from '$lib/core/nodes';
import type { EditEvent } from '$lib/editor-events';
import type { SelectionState } from '$lib/selection/selection-state.svelte';

// ── Harness ──────────────────────────────────────────────────────────────────

// Override focus to vi.fn() so cross-block dispatch tests can assert calls.
const makeRef = () => mockRef({ focus: vi.fn() });

function makeEnv(source: string) {
	const doc = parse(source);
	let blockIds = doc.children.map((_, i) => `id-${i}`);
	let blockRefs: (BlockComponent | undefined)[] = doc.children.map(() => makeRef());
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
	return { doc, deps, events, selectionState, controller, blockEdit, stickyColumn };
}

function makeHandlers(
	env: ReturnType<typeof makeEnv>,
	myPath: number[],
	getCursorOffset: () => number | null = () => 0
) {
	const stubEl = document.createElement('div');
	return createCrossBlockHandlers({
		getEl: () => stubEl,
		getMyPath: () => myPath,
		getIndex: () => myPath[0],
		selection: env.selectionState,
		getDoc: () => env.doc,
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
		grammar: undefined,
		getCursorOffset,
		afterReactivity: async () => {}
	});
}

function selectAcross(selection: SelectionState, anchor: number[], focus: number[]) {
	selection.enterCrossBlock({ path: anchor, offset: 0 }, { path: focus, offset: 0 });
}

function makeBeforeInputEvent(typed: string): InputEvent {
	const e = new (window as any).InputEvent('beforeinput', {
		inputType: 'insertText',
		data: typed,
		cancelable: true
	}) as InputEvent;
	return e;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('cross-block typed character — A2/A3 event symmetry', () => {
	it('emits op:delete then op:input when typing replaces a cross-block range', async () => {
		const env = makeEnv('hello\n\nworld\n');
		const editEvents: EditEvent[] = [];
		env.events.on('edit', (e) => editEvents.push(e));

		// Anchor at start of block 0, focus at start of block 1 — covers all of "hello\n".
		selectAcross(env.selectionState, [0], [1]);

		const handlers = makeHandlers(env, [0]);
		const handled = await handlers.handleBeforeInput(makeBeforeInputEvent('X'));
		expect(handled).toBe(true);

		const ops = editEvents.map((e) => e.op);
		expect(ops).toEqual(['delete', 'input']);

		const inputEvent = editEvents[1] as Extract<EditEvent, { op: 'input' }>;
		expect(inputEvent.detail.byteLength).toBe(1);
	});

	it('multi-character typed insert reports the full byteLength', async () => {
		const env = makeEnv('first\n\nsecond\n');
		const editEvents: EditEvent[] = [];
		env.events.on('edit', (e) => editEvents.push(e));

		selectAcross(env.selectionState, [0], [1]);

		const handlers = makeHandlers(env, [0]);
		await handlers.handleBeforeInput(makeBeforeInputEvent('ABC'));

		const inputEvent = editEvents.find((e) => e.op === 'input') as
			| Extract<EditEvent, { op: 'input' }>
			| undefined;
		expect(inputEvent).toBeDefined();
		expect(inputEvent!.detail.byteLength).toBe(3);
	});

	it('typed character lands in the merged target raw', async () => {
		const env = makeEnv('hello\n\nworld\n');

		// Cross-block from [0] offset 5 (end of "hello") to [1] offset 0 (start of "world")
		// — selecting only the paragraph break — typing should still produce delete+input
		// and leave a single merged block "helloXworld".
		env.selectionState.enterCrossBlock({ path: [0], offset: 5 }, { path: [1], offset: 0 });

		const handlers = makeHandlers(env, [0], () => 5);
		await handlers.handleBeforeInput(makeBeforeInputEvent('X'));

		expect(env.doc.children).toHaveLength(1);
		const merged = env.doc.children[0] as CstNode;
		expect(merged.raw.replace(/\s+$/, '')).toBe('helloXworld');
	});

	it('snapshot is captured pre-mutation: typed character + delete share one undo step', async () => {
		const env = makeEnv('alpha\n\nbeta\n');
		const before = env.doc.children.map((c) => (c as CstNode).raw).join('');

		selectAcross(env.selectionState, [0], [1]);

		const handlers = makeHandlers(env, [0]);
		await handlers.handleBeforeInput(makeBeforeInputEvent('Z'));

		const stacks = env.deps.undoManager.getStacks();
		expect(stacks.undo).toHaveLength(1);
		const snapshot = stacks.undo[0].snapshot;
		const snapshotSource = snapshot.children.map((c) => (c as CstNode).raw).join('');
		expect(snapshotSource).toBe(before);
	});
});

// The typed splice re-parses the surviving leaf inside the commit, so a marker at
// offset 0 re-derives the kind (parity with the single-block type path). Before the
// fix the raw was spliced with the kind held stale until the next full re-parse.
describe('cross-block typed character — kind re-derivation at offset 0', () => {
	it('a marker at offset 0 of an emptied survivor re-parses to the new kind', async () => {
		const env = makeEnv('aaa\n\nbbb\n');

		// Select both blocks whole; the delete empties the survivor at [0] offset 0.
		env.selectionState.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 3 });

		const handlers = makeHandlers(env, [0]);
		await handlers.handleBeforeInput(makeBeforeInputEvent('#'));

		expect(env.doc.children).toHaveLength(1);
		const survivor = env.doc.children[0] as CstNode;
		expect(survivor.kind).toBe('heading');
		expect(survivor.raw.replace(/\s+$/, '')).toBe('#');
	});

	it('a non-marker character keeps the kind: the fast path stays in place', async () => {
		const env = makeEnv('aaa\n\nbbb\n');

		env.selectionState.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 3 });

		const handlers = makeHandlers(env, [0]);
		await handlers.handleBeforeInput(makeBeforeInputEvent('x'));

		expect(env.doc.children).toHaveLength(1);
		const survivor = env.doc.children[0] as CstNode;
		expect(survivor.kind).toBe('paragraph');
		expect(survivor.raw.replace(/\s+$/, '')).toBe('x');
	});
});
