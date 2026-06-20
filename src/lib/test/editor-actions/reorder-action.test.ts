import { describe, it, expect } from 'vitest';
import { parse } from '$lib/editor/core/parser';
import { serialize } from '$lib/editor/core/serializer';
import { createUndoController } from '$lib/editor/editor-actions/undo/undo-controller';
import { createHistoryActions } from '$lib/editor/editor-actions/undo/history';
import { createReorderAction } from '$lib/editor/editor-actions/reorder-action';
import { createBlockListState } from '$lib/editor/reactivity/block-list-state.svelte';
import { mockRef, makeEditorActionsDeps } from '$lib/editor/test/harness/editor-actions';

// ── Top-level harness ─────────────────────────────────────────────────────────

// Build top-level children through `parse` so blank-line separators exist as real
// `leadingTrivia` — a hand-built `{ raw }` node has none, and the positional-trivia
// reorder fix only shows up against genuine separators.
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

// Seed innerBlockRefs to mirror a mounted container ({#each} never runs in node
// env) and register the live node's state so the action's expectStateForNode
// resolves. The state object is the one the harness asserts against.
function makeContainer(source: string) {
	const initial = parse(source).children[0];
	const harness = makeEditorActionsDeps([initial]);
	const node = () => harness.doc.children[0];
	const controller = createUndoController(harness.deps);
	const history = createHistoryActions(harness.deps, controller);
	const reorder = createReorderAction(harness.deps, controller);
	const state = createBlockListState(node);
	state.innerBlockRefs = (initial.children ?? []).map(() => mockRef());
	return {
		doc: harness.doc,
		node,
		state,
		reorder,
		undo: history.requestUndo,
		ids: () => state.innerBlockIds,
		stable() {
			const live = serialize(harness.doc);
			return serialize(parse(live)) === live;
		}
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('reorder action — top level', () => {
	it('nudge moves a block down, one undo step, ids preserved via idMap', async () => {
		const h = makeTop(['a', 'b', 'c']);
		const idsBefore = h.ids().slice();

		await h.reorder.nudgeReorderUnit([1], 1); // 'b' down past 'c'

		expect(serialize(h.doc)).toBe('a\n\nc\n\nb\n');
		expect(h.ids()[2]).toBe(idsBefore[1]); // 'b' kept its id (idMap permute, no recreate)
		expect(h.ids()[1]).toBe(idsBefore[2]); // 'c' shifted up keeping its id
		h.assertAligned();
	});

	it('nudge up at the head clamps to a no-op', async () => {
		const h = makeTop(['a', 'b']);
		const idsBefore = h.ids().slice();

		await h.reorder.nudgeReorderUnit([0], -1); // already first

		expect(serialize(h.doc)).toBe('a\n\nb\n');
		expect(h.ids()).toEqual(idsBefore);
	});

	it('undo restores the original order in one step', async () => {
		const h = makeTop(['a', 'b', 'c']);
		await h.reorder.nudgeReorderUnit([0], 1); // a down
		expect(serialize(h.doc)).toBe('b\n\na\n\nc\n');
		await h.undo();
		expect(serialize(h.doc)).toBe('a\n\nb\n\nc\n');
	});

	// A "loose list" — blank lines between items — parses to separate top-level
	// `list` nodes (the blank line is the next list's leadingTrivia), so reordering
	// it is the document branch. The separators must stay positional: the moved
	// list adopts its destination slot's blank line, not drag its own along.
	it('reorders blank-separated top-level list nodes, separators stay positional', async () => {
		const harness = makeEditorActionsDeps(parse('- one\n\n- two\n\n- three\n').children);
		const controller = createUndoController(harness.deps);
		const reorder = createReorderAction(harness.deps, controller);

		await reorder.moveReorderUnit([0], 2); // first list -> last

		const live = serialize(harness.doc);
		expect(live).toBe('- two\n\n- three\n\n- one\n');
		expect(serialize(parse(live))).toBe(live); // byte-stable round-trip
	});
});

describe('reorder action — list', () => {
	it('nudge moves a list item up and down (down at the tail clamps)', async () => {
		const up = makeContainer('- one\n- two\n- three\n');
		await up.reorder.nudgeReorderUnit([0, 2, 0], -1); // 3rd item up
		expect(serialize(up.doc)).toBe('- one\n- three\n- two\n');

		const down = makeContainer('- one\n- two\n- three\n');
		await down.reorder.nudgeReorderUnit([0, 2, 0], 1); // 3rd item down — already last
		expect(serialize(down.doc)).toBe('- one\n- two\n- three\n');
	});

	it('moving a list item keeps its keyed id (idMap, not recreate)', async () => {
		const h = makeContainer('- one\n- two\n- three\n');
		const idsBefore = h.ids().slice();
		await h.reorder.nudgeReorderUnit([0, 2, 0], -1); // three up to index 1
		expect(h.ids()[1]).toBe(idsBefore[2]);
		expect(h.ids()[2]).toBe(idsBefore[1]);
	});

	it('ordered list renumbers and stays byte-stable', async () => {
		const h = makeContainer('1. one\n2. two\n3. three\n');
		await h.reorder.nudgeReorderUnit([0, 2, 0], -1); // three up
		expect(serialize(h.doc)).toBe('1. one\n2. three\n3. two\n');
		expect(h.stable()).toBe(true);
	});
});

describe('reorder action — blockquote', () => {
	it('drag move (absolute toIndex) reorders and undoes in one byte-exact step', async () => {
		const h = makeContainer('> a\n>\n> b\n>\n> c\n');
		await h.reorder.moveReorderUnit([0, 0], 2); // a -> last
		expect(serialize(h.doc)).toBe('> b\n>\n> c\n>\n> a\n');
		await h.undo();
		expect(serialize(h.doc)).toBe('> a\n>\n> b\n>\n> c\n');
	});

	it('drag move clamps an out-of-range toIndex to the last slot', async () => {
		const h = makeContainer('> a\n>\n> b\n>\n> c\n');
		await h.reorder.moveReorderUnit([0, 0], 99); // clamps to 2
		expect(serialize(h.doc)).toBe('> b\n>\n> c\n>\n> a\n');
	});
});
