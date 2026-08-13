import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { rangeSelectionOf } from '$lib/test/support/undo-entry';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import { createReorderAction } from '$lib/editor-actions/reorder-action';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import { replaceRefs } from '$lib/reactivity/publish-ref.svelte';
import { mockRef, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import type { CstNode } from '$lib/core/nodes';

// ── Top-level harness ─────────────────────────────────────────────────────────

// Built through `parse` so blank-line separators exist as real `leadingTrivia` — a
// hand-built `{ raw }` node has none, and positional trivia only shows up against genuine ones.
function makeTop(raws: string[]) {
	const harness = makeEditorActionsDeps(parse(raws.join('\n\n') + '\n').children);
	const controller = createUndoController(harness.deps);
	const history = createHistoryActions(harness.deps, controller);
	const reorder = createReorderAction(harness.deps, controller);
	return {
		doc: harness.doc,
		reorder,
		ids: harness.getBlockIds,
		undo: history.requestUndo,
		assertAligned() {
			const n = harness.doc.children.length;
			expect(harness.getBlockIds()).toHaveLength(n);
			expect(harness.getBlockRefs()).toHaveLength(n);
			expect(new Set(harness.getBlockIds()).size).toBe(n);
		}
	};
}

// ── Container harness ─────────────────────────────────────────────────────────

// Seeds innerBlockRefs to mimic a mounted container ({#each} never runs in node env)
// and registers the live node's state so the action's expectStateForNode resolves.
function makeContainer(source: string) {
	const initial = parse(source).children[0];
	const harness = makeEditorActionsDeps([initial]);
	const node = () => harness.doc.children[0];
	const controller = createUndoController(harness.deps);
	const history = createHistoryActions(harness.deps, controller);
	const reorder = createReorderAction(harness.deps, controller);
	const state = createBlockListState(node);
	replaceRefs(
		state.innerBlockRefs,
		(initial.children ?? []).map(() => mockRef())
	);
	return {
		doc: harness.doc,
		node,
		state,
		reorder,
		deps: harness.deps,
		undo: history.requestUndo,
		ids: () => state.innerBlockIds,
		// Convergence, not just a byte round-trip: the round trip is blind to a stale
		// container raw or a renumber-desynced marker the permutation left behind.
		assertStable() {
			expectParseConverged(harness.doc);
			const live = serialize(harness.doc);
			expect(serialize(parse(live))).toBe(live);
		}
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('reorder action — top level', () => {
	it('nudge moves a block down, one undo step, ids preserved via idMap', async () => {
		const h = makeTop(['a', 'b', 'c']);
		const idsBefore = h.ids().slice();

		await h.reorder.nudgeReorderUnit([1], 1);

		expect(serialize(h.doc)).toBe('a\n\nc\n\nb\n');
		expect(h.ids()[2]).toBe(idsBefore[1]);
		expect(h.ids()[1]).toBe(idsBefore[2]);
		h.assertAligned();
	});

	it('nudge up at the head clamps to a no-op', async () => {
		const h = makeTop(['a', 'b']);
		const idsBefore = h.ids().slice();

		await h.reorder.nudgeReorderUnit([0], -1);

		expect(serialize(h.doc)).toBe('a\n\nb\n');
		expect(h.ids()).toEqual(idsBefore);
	});

	it('undo restores the original order in one step', async () => {
		const h = makeTop(['a', 'b', 'c']);
		await h.reorder.nudgeReorderUnit([0], 1);
		expect(serialize(h.doc)).toBe('b\n\na\n\nc\n');
		await h.undo();
		expect(serialize(h.doc)).toBe('a\n\nb\n\nc\n');
	});

	// A "loose list" parses to separate top-level `list` nodes (the blank line is the
	// next list's leadingTrivia), so this is the document branch, not the list branch.
	it('reorders blank-separated top-level list nodes, separators stay positional', async () => {
		const harness = makeEditorActionsDeps(parse('- one\n\n- two\n\n- three\n').children);
		const controller = createUndoController(harness.deps);
		const reorder = createReorderAction(harness.deps, controller);

		await reorder.moveReorderUnit([0], 2);

		const live = serialize(harness.doc);
		expect(live).toBe('- two\n\n- three\n\n- one\n');
		expectParseConverged(harness.doc);
		expect(serialize(parse(live))).toBe(live);
	});
});

describe('reorder action — list', () => {
	it('nudge moves a list item up and down (down at the tail clamps)', async () => {
		const up = makeContainer('- one\n- two\n- three\n');
		await up.reorder.nudgeReorderUnit([0, 2, 0], -1);
		expect(serialize(up.doc)).toBe('- one\n- three\n- two\n');

		const down = makeContainer('- one\n- two\n- three\n');
		await down.reorder.nudgeReorderUnit([0, 2, 0], 1);
		expect(serialize(down.doc)).toBe('- one\n- two\n- three\n');
	});

	it('moving a list item keeps its keyed id (idMap, not recreate)', async () => {
		const h = makeContainer('- one\n- two\n- three\n');
		const idsBefore = h.ids().slice();
		await h.reorder.nudgeReorderUnit([0, 2, 0], -1);
		expect(h.ids()[1]).toBe(idsBefore[2]);
		expect(h.ids()[2]).toBe(idsBefore[1]);
	});

	it('ordered list renumbers and stays byte-stable', async () => {
		const h = makeContainer('1. one\n2. two\n3. three\n');
		await h.reorder.nudgeReorderUnit([0, 2, 0], -1);
		expect(serialize(h.doc)).toBe('1. one\n2. three\n3. two\n');
		h.assertStable();
	});
});

describe('reorder action — blockquote', () => {
	it('drag move (absolute toIndex) reorders and undoes in one byte-exact step', async () => {
		const h = makeContainer('> a\n>\n> b\n>\n> c\n');
		await h.reorder.moveReorderUnit([0, 0], 2);
		expect(serialize(h.doc)).toBe('> b\n>\n> c\n>\n> a\n');
		await h.undo();
		expect(serialize(h.doc)).toBe('> a\n>\n> b\n>\n> c\n');
	});

	it('drag move clamps an out-of-range toIndex to the last slot', async () => {
		const h = makeContainer('> a\n>\n> b\n>\n> c\n');
		await h.reorder.moveReorderUnit([0, 0], 99);
		expect(serialize(h.doc)).toBe('> b\n>\n> c\n>\n> a\n');
	});

	// A drag carries no live caret, so the snapshot synthesizes the restore path; a
	// top-level index there strands the caret on an unrelated block after undo.
	it('a no-caret container reorder snapshots a deep restore path', async () => {
		const h = makeContainer('> a\n>\n> b\n>\n> c\n');
		await h.reorder.moveReorderUnit([0, 0], 2);
		const { undo } = h.deps.undoManager.getStacks();
		expect(rangeSelectionOf(undo.at(-1)!).focus.path).toEqual([0, 0]);
	});
});

describe('reorder action — plugin (opaque) container declines', () => {
	beforeEach(__resetSchemaRegistriesForTests);

	// The teleport seed: a pre-decline resolver hands back the container's DOCUMENT
	// slot, so a body-leaf gesture permutes the top-level array instead.
	function makeDeclineHarness() {
		const chromeKind = declarePluginKind('spec-chrome');
		const containerKind = declarePluginKind('spec-container');
		registerBlockKind(chromeKind, {
			mergeRole: 'not-mergeable',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			contextDependentKind: true
		});
		registerBlockKind(containerKind, {
			mergeRole: 'container',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			container: { contract: 'opaque', rebuildRaw: () => {}, reservedChrome: { kind: chromeKind } }
		});
		const container: CstNode = {
			kind: containerKind,
			leadingTrivia: '\n',
			raw: ':::spec\nBody\n:::\n',
			children: [
				{ kind: chromeKind, leadingTrivia: '', raw: '\n' },
				{ kind: 'paragraph', leadingTrivia: '', raw: 'Body\n' }
			]
		};
		const harness = makeEditorActionsDeps([
			{ kind: 'paragraph', leadingTrivia: '', raw: 'TOP\n' },
			container,
			{ kind: 'paragraph', leadingTrivia: '\n', raw: 'BOTTOM\n' }
		]);
		const controller = createUndoController(harness.deps);
		const reorder = createReorderAction(harness.deps, controller);
		return { harness, reorder };
	}

	it('a body-leaf nudge is a no-op: no permutation, no undo entry, no edit event', async () => {
		const { harness, reorder } = makeDeclineHarness();
		const before = serialize(harness.doc);
		let edits = 0;
		harness.events.on('edit', () => edits++);

		await reorder.nudgeReorderUnit([1, 1], -1);

		// Ordered so each fails independently: the commit emits an edit and pushes an
		// undo entry BEFORE the permutation reaches the bytes.
		expect(edits).toBe(0);
		expect(harness.deps.undoManager.getStacks().undo).toHaveLength(0);
		expect(serialize(harness.doc)).toBe(before);
	});

	it('a body-leaf drag move is a no-op — the teleport is gone', async () => {
		const { harness, reorder } = makeDeclineHarness();
		const before = serialize(harness.doc);
		let edits = 0;
		harness.events.on('edit', () => edits++);

		await reorder.moveReorderUnit([1, 1], 0);

		expect(edits).toBe(0);
		expect(harness.deps.undoManager.getStacks().undo).toHaveLength(0);
		expect(serialize(harness.doc)).toBe(before);
	});
});
