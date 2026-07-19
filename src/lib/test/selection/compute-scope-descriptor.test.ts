/**
 * Mixed-depth cross-block delete + cascade cleanup. Exercises
 * every documented branch of computeScopeDescriptor with the shapes that
 * actually arise from rangeDelete + cascade — both-descend, only-end-descends
 * (with and without surviving siblings past endIdx), only-start-descends,
 * and outside-selection-path. Pins the invariants the commit primitive's
 * StructuralChange applicator depends on.
 */

import { describe, it, expect } from 'vitest';
import { __computeScopeDescriptorForTests as computeScopeDescriptor } from '../../selection/cross-block/ops';

describe('computeScopeDescriptor — mixed-depth audit', () => {
	// ── Both endpoints descend (no mixed-depth branch) ────────────────────

	it('shared-ancestor scope: start and end both descend, middle range replaced', () => {
		// start=[1,0,0], end=[1,2,3] — scope [1] contains both endpoint chains.
		// Three list items become one (item at 0 survives, merged via replacement).
		const d = computeScopeDescriptor([1], [1, 0, 0], [1, 2, 3], 3, 1);
		expect(d).toEqual({
			op: 'replace',
			at: 0,
			count: 3,
			newCount: 1,
			idMap: { 0: 0 }
		});
	});

	// ── Only end descends (mixed-depth branch) ───────────────────────────

	it('start=[0], end=[1,2,3] — list at scope [1] emptied completely', () => {
		const d = computeScopeDescriptor([1], [0], [1, 2, 3], 3, 0);
		expect(d).toEqual({
			op: 'replace',
			at: 0,
			count: 3,
			newCount: 0,
			idMap: {}
		});
	});

	it('start=[0], end=[1,2,3] — list had trailing siblings past endIdx that survive', () => {
		// list1 = [item10..item14]; end descends through item12. Items 0..2
		// deleted via betweenPaths, items 3 and 4 survive.
		const d = computeScopeDescriptor([1], [0], [1, 2, 3], 5, 2);
		expect(d).toEqual({
			op: 'replace',
			at: 0,
			count: 3,
			newCount: 0,
			idMap: {}
		});
	});

	it('start=[0], end=[1,2,3] — deepest scope (item12) emptied', () => {
		const d = computeScopeDescriptor([1, 2], [0], [1, 2, 3], 4, 0);
		expect(d).toEqual({
			op: 'replace',
			at: 0,
			count: 4,
			newCount: 0,
			idMap: {}
		});
	});

	// ── Only start descends ───────────────────────────────────────────────

	it('start=[0,1,2], end=[5] — start-side cascade extends the touched range', () => {
		// Scope [0]: start descends through index 1. Cascade removes items past
		// it; the descriptor should cover the cascade-extended window.
		const d = computeScopeDescriptor([0], [0, 1, 2], [5], 4, 1);
		expect(d.op).toBe('replace');
		if (d.op === 'replace') {
			expect(d.at).toBe(1);
			expect(d.count).toBe(4);
			expect(d.newCount).toBe(1);
			expect(d.idMap).toEqual({ 0: 0 });
		}
	});

	// ── Outside the selection path ────────────────────────────────────────

	it('noop when scope is outside the selection path', () => {
		const d = computeScopeDescriptor([2], [0], [1, 2, 3], 5, 5);
		expect(d.op).toBe('noop');
	});

	// ── No net removal in the scope ───────────────────────────────────────

	it('noop when the scope lost no children: every slot survived in place', () => {
		// Doc scope for start=[0] truncated in place, end=[1] a surviving table
		// (or a replaced-in-slot leaf): ids/refs must be kept as-is, matching
		// the pure top-level path's convention.
		const d = computeScopeDescriptor([], [0], [1], 2, 2);
		expect(d).toEqual({ op: 'noop' });
	});

	// ── Table endpoint (caller passes the endpoint one level deeper) ──────

	it('surviving end table keeps its id past a removed middle block', () => {
		// start=[0], end table at [2] — the caller deepens the cell-coordinate
		// endpoint to [2,0] so the table counts as "descends deeper" (survives
		// in place unless fully consumed). Middle [1] removed.
		const d = computeScopeDescriptor([], [0], [2, 0], 3, 2);
		expect(d).toEqual({
			op: 'replace',
			at: 0,
			count: 3,
			newCount: 2,
			idMap: { 0: 0, 1: 2 }
		});
	});

	// ── Invariant audit across the mixed-depth branch ────────────────────

	it('descriptor stays in bounds for every realistic mixed-depth shape', () => {
		// endIdxInScope, beforeLen, removed — derived from betweenPaths coverage.
		// beforeLen ≥ endIdx + 1 always (the endpoint's ancestor is present).
		// removed ≤ endIdx + 1 at the only-end-descends scope (items past endIdx
		// are after the selection in doc order and never in betweenPaths).
		const cases: Array<[number, number, number]> = [
			[0, 1, 1], // lone item, fully removed
			[2, 3, 3], // all 3 removed (end descends through last)
			[2, 5, 3], // 3 removed, 2 trailing siblings survive
			[3, 4, 4], // 4 removed, end at last index
			[3, 4, 1] // only the endpoint's ancestor removed (1-deep cascade)
		];
		for (const [endIdx, beforeLen, removed] of cases) {
			const afterLen = beforeLen - removed;
			const d = computeScopeDescriptor([1], [0], [1, endIdx, 0], beforeLen, afterLen);
			expect(d.op).toBe('replace');
			if (d.op === 'replace') {
				// The applicator's net array shrink must match `removed`.
				expect(d.count - d.newCount).toBe(removed);
				// The descriptor window must fit inside the pre-mutation array.
				expect(d.at).toBeGreaterThanOrEqual(0);
				expect(d.at + d.count).toBeLessThanOrEqual(beforeLen);
				// newCount cannot go negative.
				expect(d.newCount).toBeGreaterThanOrEqual(0);
			}
		}
	});
});
