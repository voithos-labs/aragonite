// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { restoreGapCaret } from '$lib/selection/selection-restore';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import type { SelectionRestoreDeps } from '$lib/selection/selection-restore';
import { expectDevWarns } from '$lib/test/support/warn-gate';

// The fixtures seat table endpoints directly instead of through SelectionState, so the coordinate
// guard sees the un-normalized point.
afterEach(() => expectDevWarns(['invariant:cross-block-endpoint-coordinates']));

// Restoring a gap-carrying undo entry: the boundary is clamped into the tree it lands in,
// and the block it sits against is revealed before the caret parks.

const DOC = '| a |\n| - |\n\n```\nx\n```\n\n> para\n>\n> ```\n> y\n> ```\n';

function harness(overrides: Partial<SelectionRestoreDeps> = {}) {
	const doc = parse(DOC);
	const revealed: number[][] = [];
	const selectionState = createSelectionState({ getDoc: () => doc });
	const deps: SelectionRestoreDeps = {
		getDoc: () => doc,
		selectionState,
		getBlockElByPath: () => null,
		revealTarget: async (path) => {
			revealed.push(path);
			return true;
		},
		...overrides
	};
	return { doc, deps, revealed, selectionState };
}

describe('restoreGapCaret', () => {
	it('parks the boundary and reveals the block it sits before', async () => {
		const h = harness();

		const outcome = await restoreGapCaret({ parentPath: [], index: 1 }, h.deps);

		expect(outcome).toBe('applied');
		expect(h.selectionState.gapCaret).toEqual({ parentPath: [], index: 1 });
		expect(h.revealed).toEqual([[1]]);
	});

	// At the scope end there is no block AT the index, so the reveal takes the one before it.
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

	// A fence has no children, so a path naming it as a scope addresses no boundary at all.
	it('declines a childless leaf as a parent', async () => {
		const h = harness();

		expect(await restoreGapCaret({ parentPath: [1], index: 0 }, h.deps)).toBe('unresolvable');
		expect(h.selectionState.gapCaret).toBeNull();
	});

	// The reveal is best-effort; the caret still parks, as the endpoint road's does.
	it('reports unplaced but still parks when the reveal misses', async () => {
		const h = harness({ revealTarget: async () => false });

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
