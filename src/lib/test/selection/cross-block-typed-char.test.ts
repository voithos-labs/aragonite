// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createCrossBlockHandlers } from '$lib/editor/selection/cross-block-dispatch';
import { createSelectionState } from '$lib/editor/selection/selection-state.svelte';
import { createUndoController } from '$lib/editor/components/editor-actions/undo-controller';
import { createBlockEditActions } from '$lib/editor/components/editor-actions/block-edit';
import { createContainerEditActions } from '$lib/editor/components/editor-actions/container-edit';
import { createUndoManager } from '$lib/editor/undo-manager';
import { createEditorEvents } from '$lib/editor/events/editor-events';
import { parse } from '$lib/editor/core/parser';
import type { BlockComponent, CstNode, EditEvent } from '$lib/editor/contracts';
import type { StickyColumnState } from '$lib/editor/contenteditable/sticky-column';
import type { SelectionState } from '$lib/editor/selection/selection-state.svelte';

// ── Harness ──────────────────────────────────────────────────────────────────

function makeStickyColumn(): StickyColumnState {
	return { get: () => null, reset: vi.fn(), capture: vi.fn() };
}

function makeRef(): BlockComponent {
	return {
		focus: vi.fn(),
		getCursorOffset: () => null,
		editable: true,
		focusable: true
	} as BlockComponent;
}

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
		stickyColumn,
		selectionState,
		getBlockElByPath: () => null,
		events
	};
	const controller = createUndoController(deps);
	const blockEdit = createBlockEditActions(deps, controller);
	const containerEdit = createContainerEditActions(deps, controller);
	return { doc, deps, events, selectionState, controller, blockEdit, containerEdit, stickyColumn };
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
		getEditorRoot: () => null,
		getEditorLifetime: () => null,
		stickyColumn: env.stickyColumn,
		containerEdit: env.containerEdit,
		blockEdit: env.blockEdit,
		controller: env.controller,
		getCursorOffset,
		afterReactivity: async () => {},
		setPendingCursor: () => {}
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
