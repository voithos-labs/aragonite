// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { restoreGapCaret } from '#lib/selection/selection-restore.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import type { GapCaretRestoreDeps } from '#lib/selection/selection-restore.js';
import { createCaretMemory } from '#lib/caret/caret-memory.js';
import { stubBlockComponent } from '#lib/testing/headless-actions.js';

// Restoring an undo entry that holds a gap caret: the boundary is clamped into the tree it
// lands in, and the block it sits against is mounted and brought into view before the caret.

const DOC = '| a |\n| - |\n\n```\nx\n```\n\n> para\n>\n> ```\n> y\n> ```\n';

function harness(overrides: Partial<GapCaretRestoreDeps> = {}) {
	const doc = parse(DOC);
	const revealed: number[][] = [];
	const inView: number[][] = [];
	const selectionState = createSelectionState({ getDoc: () => doc });
	const deps: GapCaretRestoreDeps = {
		getDoc: () => doc,
		selectionState,
		caretMemory: createCaretMemory(),
		mount: async (path) => {
			revealed.push(path);
			return stubBlockComponent();
		},
		reveal: async (path) => {
			// Before the caret, so the gap it lands at renders in view.
			expect(selectionState.gapCaret).toBeNull();
			inView.push(path);
		},
		...overrides
	};
	return { doc, deps, revealed, inView, selectionState };
}

describe('restoreGapCaret', () => {
	it('puts the caret the boundary and reveals the block it sits before', async () => {
		const h = harness();

		const outcome = await restoreGapCaret({ parentPath: [], index: 1 }, h.deps);

		expect(outcome).toBe('applied');
		expect(h.selectionState.gapCaret).toEqual({ parentPath: [], index: 1 });
		expect(h.revealed).toEqual([[1]]);
		expect(h.inView).toEqual([[1]]);
	});

	// A restored gap caret is placed, not arrived at by a key, like any restored caret.
	it('forgets the pending marks and the side a key recorded', async () => {
		const memory = createCaretMemory();
		memory.noteKey({ key: 'End' }, null);
		memory.pendingMarks.toggle('strong');
		const h = harness({ caretMemory: memory });

		await restoreGapCaret({ parentPath: [], index: 1 }, h.deps);

		expect(memory.side()).toBeNull();
		expect(memory.pendingMarks.get()).toBeNull();
	});

	// At the end of the child list there is no block at the index, so the block before it is
	// mounted instead.
	it('reveals the preceding block at a scope-end boundary', async () => {
		const h = harness();

		await restoreGapCaret({ parentPath: [2], index: 2 }, h.deps);

		expect(h.selectionState.gapCaret).toEqual({ parentPath: [2], index: 2 });
		expect(h.revealed).toEqual([[2, 1]]);
	});

	it.each([
		['past the end', 99, 3],
		['below zero', -4, 0]
	])('clamps an index %s into the tree it lands in', async (_label, index, expected) => {
		const h = harness();

		await restoreGapCaret({ parentPath: [], index }, h.deps);

		expect(h.selectionState.gapCaret).toEqual({ parentPath: [], index: expected });
	});

	it('declines an unresolvable parent without touching the selection', async () => {
		const h = harness();

		const outcome = await restoreGapCaret({ parentPath: [9, 9], index: 0 }, h.deps);

		expect(outcome).toBe('unresolvable');
		expect(h.selectionState.gapCaret).toBeNull();
		expect(h.revealed).toEqual([]);
	});

	// A fence has no children, so a path naming it as the parent addresses no boundary at all.
	it('declines a childless leaf as a parent', async () => {
		const h = harness();

		expect(await restoreGapCaret({ parentPath: [1], index: 0 }, h.deps)).toBe('unresolvable');
		expect(h.selectionState.gapCaret).toBeNull();
	});

	// The mount is best effort; the caret is still placed, as it is for an endpoint pair.
	it('reports unplaced but still puts the caret when the reveal misses', async () => {
		const h = harness({ mount: async () => null });

		const outcome = await restoreGapCaret({ parentPath: [], index: 1 }, h.deps);

		expect(outcome).toBe('unplaced');
		expect(h.selectionState.gapCaret).toEqual({ parentPath: [], index: 1 });
	});

	it('ends a live cross-block range, as every other caret landing does', async () => {
		const h = harness();
		h.selectionState.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 2 });

		await restoreGapCaret({ parentPath: [], index: 1 }, h.deps);

		expect(h.selectionState.isCrossBlock).toBe(false);
		expect(h.selectionState.gapCaret).toEqual({ parentPath: [], index: 1 });
	});
});
