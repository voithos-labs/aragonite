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
import { refSlotsOver } from '$lib/reactivity/publish-ref.svelte';
import { parse } from '$lib/core/parser';
import { lrdMapCouldChange } from '$lib/components/lrd-map-gate';
import { buildLinkReferenceMap } from '$lib/core/inline/link-reference-resolver';
import { mockRef, makeStickyColumn, makeEdgeAffinity } from '$lib/test/harness/editor-actions';
import type { BlockComponent } from '$lib/block-component';
import type { CstNode } from '$lib/core/nodes';
import type { EditEvent } from '$lib/editor-events';
import type { LinkReferenceResolver } from '$lib/core/inline/link-reference-resolver';
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
		blockRefSlots: refSlotsOver(() => blockRefs),
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
		getScrollHost: () => null,
		getEditorLifetime: () => null,
		stickyColumn: env.stickyColumn,
		edgeAffinity: env.edgeAffinity,
		blockEdit: env.blockEdit,
		controller: env.controller,
		history: { requestUndo() {}, requestRedo() {} },
		pluginEditor: undefined,
		getPresentationMode: () => 'source' as const,
		onCommandError: undefined,
		getKeybindingOverrides: () => normalizeKeybindingOverrides(undefined),
		pasteCoordinator: createPasteCoordinator(env.controller, env.deps.revealPath),
		grammar: undefined,
		events: env.events,
		getCursorOffset,
		afterReactivity: async () => {}
	});
}

function selectAcross(selection: SelectionState, anchor: number[], focus: number[]) {
	selection.enterCrossBlock({ path: anchor, offset: 0 }, { path: focus, offset: 0 });
}

/**
 * Mirror of the shell's own `edit` subscriber (`Editor.svelte`): rebuild the link-reference map
 * whenever the gate says a commit could have changed the definition set, reading the live
 * post-commit document. Replaying the collected events afterwards would not reproduce the shell.
 */
function trackLrdResolver(env: ReturnType<typeof makeEnv>): () => LinkReferenceResolver {
	let resolve = buildLinkReferenceMap(env.doc.children).resolve;
	env.events.on('edit', (e) => {
		if (lrdMapCouldChange(env.doc, e)) resolve = buildLinkReferenceMap(env.doc.children).resolve;
	});
	return () => resolve;
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
	// The commit re-derives the leaf's kind, so it declares `updateContent`, not `input` — matching
	// the single-block kind-changing branch, with the post-edit block's full text length as detail.
	it.each(['X', 'ABC'])('emits op:delete then op:updateContent for a typed "%s"', async (typed) => {
		const env = makeEnv('hello\n\nworld\n');
		const editEvents: EditEvent[] = [];
		env.events.on('edit', (e) => editEvents.push(e));

		// Anchor at start of block 0, focus at start of block 1 — covers all of "hello\n".
		selectAcross(env.selectionState, [0], [1]);

		const handlers = makeHandlers(env, [0]);
		const handled = await handlers.handleBeforeInput(makeBeforeInputEvent(typed));
		expect(handled).toBe(true);

		expect(editEvents.map((e) => e.op)).toEqual(['delete', 'updateContent']);

		const update = editEvents[1] as Extract<EditEvent, { op: 'updateContent' }>;
		// Both arms: the block-length contract, and the arithmetic that pins it —
		// the first alone would pass against a survivor that is not what we think.
		expect(update.detail.length).toBe((env.doc.children[0] as CstNode).raw.length);
		expect(update.detail.length).toBe('world\n'.length + typed.length);
	});

	it('typed character lands in the merged target raw', async () => {
		const env = makeEnv('hello\n\nworld\n');

		// Selecting only the paragraph break, [0] offset 5 to [1] offset 0: typing should still produce
		// delete+input and leave a single merged block.
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

// The typed splice re-parses the surviving leaf inside the commit, so a marker at offset 0
// re-derives the kind (parity with the single-block type path) rather than holding it stale.
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

// A commit that re-derives the kind must declare an op the LRD gate treats as kind-unstable:
// under `input` the gate read the POST-commit kind and kept serving a destroyed definition.
describe('cross-block typed character — link-reference resolver freshness', () => {
	it('a type-replace that destroys a definition stops the resolver serving it', async () => {
		const env = makeEnv('[label]: /a\n\n[ref]: /b\n\nSee [ref] and [label].\n');
		const resolver = trackLrdResolver(env);
		const editEvents: EditEvent[] = [];
		env.events.on('edit', (e) => editEvents.push(e));
		expect(resolver()('ref')).toEqual({ url: '/b' });

		// The delete drops `[label]` and leaves `[ref]: /b` at [0], which the typed `x` reparses into
		// prose — the document then defines neither label.
		selectAcross(env.selectionState, [0], [1]);
		const handlers = makeHandlers(env, [0]);
		await handlers.handleBeforeInput(makeBeforeInputEvent('x'));

		const survivor = env.doc.children[0] as CstNode;
		expect(survivor.kind).toBe('paragraph');
		expect(resolver()('ref')).toBeUndefined();
		expect(resolver()('label')).toBeUndefined();

		// The detail is computed before the commit, but a kind change mints a fresh node by re-parsing,
		// so the length contract needs checking on THIS arm, not only on the kind-stable one above.
		const update = editEvents.at(-1) as Extract<EditEvent, { op: 'updateContent' }>;
		expect(update.op).toBe('updateContent');
		expect(update.detail.length).toBe(survivor.raw.length);
	});

	it('a type-replace that creates a definition makes the resolver serve it', async () => {
		// The other direction of the same gate decision: the post-commit kind IS
		// `linkReferenceDefinition`, which is why this arm survived the bug.
		const env = makeEnv('drop me\n\nlabel]: /a\n');
		const resolver = trackLrdResolver(env);
		expect(resolver()('label')).toBeUndefined();

		selectAcross(env.selectionState, [0], [1]);
		const handlers = makeHandlers(env, [0]);
		await handlers.handleBeforeInput(makeBeforeInputEvent('['));

		expect((env.doc.children[0] as CstNode).kind).toBe('linkReferenceDefinition');
		expect(resolver()('label')).toEqual({ url: '/a' });
	});
});
