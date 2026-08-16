import { describe, it, expect } from 'vitest';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { parse } from '../../core/parser';
import { allowDevWarns } from '$lib/test/support/warn-gate';

describe('SelectionState lifecycle', () => {
	it('starts empty and reports not cross-block', () => {
		const s = createSelectionState();
		expect(s.isCrossBlock).toBe(false);
		expect(s.anchor).toBeNull();
		expect(s.focus).toBeNull();
	});

	it('enterCrossBlock populates anchor and focus', () => {
		const s = createSelectionState();
		s.enterCrossBlock({ path: [0], offset: 2 }, { path: [1], offset: 4 });
		expect(s.isCrossBlock).toBe(true);
		expect(s.anchor).toEqual({ path: [0], offset: 2 });
		expect(s.focus).toEqual({ path: [1], offset: 4 });
	});

	it('extendFocus moves focus while leaving anchor fixed', () => {
		const s = createSelectionState();
		s.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 0 });
		s.extendFocus({ path: [2], offset: 3 });
		expect(s.anchor).toEqual({ path: [0], offset: 0 });
		expect(s.focus).toEqual({ path: [2], offset: 3 });
	});

	it('clear resets everything', () => {
		const s = createSelectionState();
		s.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 0 });
		s.clear();
		expect(s.isCrossBlock).toBe(false);
		expect(s.anchor).toBeNull();
		expect(s.focus).toBeNull();
	});

	it('start and end are normalized in document order', () => {
		const s = createSelectionState();
		s.enterCrossBlock({ path: [3], offset: 2 }, { path: [0], offset: 5 });
		expect(s.start).toEqual({ path: [0], offset: 5 });
		expect(s.end).toEqual({ path: [3], offset: 2 });
	});

	it('collapses a same-path prose range instead of entering cross-block (E-F1)', () => {
		const s = createSelectionState();
		s.enterCrossBlock({ path: [0], offset: 0 }, { path: [0], offset: 5 });
		expect(s.isCrossBlock).toBe(false);
		expect(s.anchor).toBeNull();
		expect(s.focus).toBeNull();
	});

	it('keeps the same-offset keyboard seed so its follow-up extend has an anchor', () => {
		const s = createSelectionState();
		s.enterCrossBlock({ path: [0], offset: 3 }, { path: [0], offset: 3 });
		expect(s.isCrossBlock).toBe(true);
		s.extendFocus({ path: [1], offset: 0 });
		expect(s.anchor).toEqual({ path: [0], offset: 3 });
		expect(s.focus).toEqual({ path: [1], offset: 0 });
	});

	it('collapses when extendFocus contracts onto the anchor prose leaf', () => {
		const s = createSelectionState();
		s.enterCrossBlock({ path: [0], offset: 3 }, { path: [1], offset: 0 });
		expect(s.isCrossBlock).toBe(true);
		s.extendFocus({ path: [0], offset: 8 });
		expect(s.isCrossBlock).toBe(false);
		expect(s.anchor).toBeNull();
	});

	it('ctrl+a doubling counter tracks press count', () => {
		const s = createSelectionState();
		expect(s.selectAllCount).toBe(0);
		s.incrementSelectAllCount();
		expect(s.selectAllCount).toBe(1);
		s.incrementSelectAllCount();
		expect(s.selectAllCount).toBe(2);
		s.resetSelectAllCount();
		expect(s.selectAllCount).toBe(0);
	});
});

describe('SelectionState.isCustomRendered', () => {
	const tableSource = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

	it('is true for a same-path table rect (flagged anchor, cell-index selection)', () => {
		const doc = parse(tableSource);
		const s = createSelectionState({ getDoc: () => doc });
		// Real rects flag the anchor as a cell coordinate (cell-pointer.ts); an
		// unflagged char pair would collapse to single-block instead.
		s.enterCrossBlock({ path: [0], offset: 0, cellCoordinate: true }, { path: [0], offset: 1 });
		expect(s.isCustomRendered).toBe(true);
	});

	// Deep row/cell paths are unstorable: the state normalizes them to the table block plus a
	// row-major cell index on entry, so a pair addressing one cell collapses.
	for (const path of [
		[0, 0],
		[0, 0, 0]
	]) {
		it(`normalizes a deep same-path pair at [${path.join(',')}] to table cell coordinates`, () => {
			const doc = parse(tableSource);
			const s = createSelectionState({ getDoc: () => doc });
			s.enterCrossBlock({ path: path.slice(), offset: 0 }, { path: path.slice(), offset: 1 });
			expect(s.anchor).toEqual({ path: [0], offset: 0, cellCoordinate: true });
			expect(s.focus).toEqual({ path: [0], offset: 0, cellCoordinate: true });
			expect(s.isCustomRendered).toBe(false);
		});
	}

	it('is true when paths differ (genuine cross-block range)', () => {
		const doc = parse('a\n\nb\n');
		const s = createSelectionState({ getDoc: () => doc });
		s.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 1 });
		expect(s.isCustomRendered).toBe(true);
	});

	it('is false for collapsed selection on a table path', () => {
		const doc = parse(tableSource);
		const s = createSelectionState({ getDoc: () => doc });
		s.enterCrossBlock({ path: [0], offset: 0 }, { path: [0], offset: 0 });
		expect(s.isCustomRendered).toBe(false);
	});

	it('never renders custom for a same-path prose range — it collapses to native', () => {
		const doc = parse('paragraph one\n\n> quoted\n');
		const s = createSelectionState({ getDoc: () => doc });
		s.enterCrossBlock({ path: [0], offset: 0 }, { path: [0], offset: 5 });
		expect(s.isCrossBlock).toBe(false);
		expect(s.isCustomRendered).toBe(false);
		s.enterCrossBlock({ path: [1], offset: 0 }, { path: [1], offset: 3 });
		expect(s.isCrossBlock).toBe(false);
		expect(s.isCustomRendered).toBe(false);
	});

	it('falls back to isCrossBlock when getDoc is not provided', () => {
		const s = createSelectionState();
		expect(s.isCustomRendered).toBe(false);
		s.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 0 });
		expect(s.isCustomRendered).toBe(true);
	});
});

describe('SelectionState.restoreRoute (classify a pair without mutating state)', () => {
	const tableSource = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

	it('routes distinct paths as custom (cross-block)', () => {
		const doc = parse('a\n\nb\n');
		const s = createSelectionState({ getDoc: () => doc });
		expect(s.restoreRoute({ path: [0], offset: 0 }, { path: [1], offset: 1 })).toBe('custom');
	});

	it('routes an equal-offset pair as collapsed', () => {
		const s = createSelectionState();
		expect(s.restoreRoute({ path: [0], offset: 3 }, { path: [0], offset: 3 })).toBe('collapsed');
	});

	it('routes a same-path prose range as single-block', () => {
		const doc = parse('paragraph\n');
		const s = createSelectionState({ getDoc: () => doc });
		expect(s.restoreRoute({ path: [0], offset: 0 }, { path: [0], offset: 5 })).toBe('single-block');
	});

	it('routes a same-path table range as custom (cell rect)', () => {
		const doc = parse(tableSource);
		const s = createSelectionState({ getDoc: () => doc });
		// Flagged anchor and context-established (unflagged) focus both classify custom.
		expect(
			s.restoreRoute({ path: [0], offset: 0, cellCoordinate: true }, { path: [0], offset: 1 })
		).toBe('custom');
		expect(s.restoreRoute({ path: [0], offset: 0 }, { path: [0], offset: 1 })).toBe('custom');
	});

	it('treats a same-path range as single-block when no doc accessor is wired', () => {
		const s = createSelectionState();
		expect(s.restoreRoute({ path: [0], offset: 0 }, { path: [0], offset: 5 })).toBe('single-block');
	});
});

describe('SelectionState.cellLandingFor', () => {
	const tableSource = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

	it('lands a flagged cell endpoint at the start of its deep [table,row,col] leaf', () => {
		const doc = parse(tableSource);
		const s = createSelectionState({ getDoc: () => doc });
		// cellIdx 3 in a 2-column table = row 1, col 1.
		expect(s.cellLandingFor({ path: [0], offset: 3, cellCoordinate: true })).toEqual({
			path: [0, 1, 1],
			offset: 0
		});
	});

	it('lands a context-established (unflagged) intra-table endpoint too (E-F4)', () => {
		const doc = parse(tableSource);
		const s = createSelectionState({ getDoc: () => doc });
		expect(s.cellLandingFor({ path: [0], offset: 2 })).toEqual({ path: [0, 1, 0], offset: 0 });
	});

	// The fallback is what lets every caller drop its own `?? point` arm.
	it('lands a prose endpoint as itself, offset included', () => {
		const doc = parse('paragraph\n');
		const s = createSelectionState({ getDoc: () => doc });
		const point = { path: [0], offset: 3 };
		expect(s.cellLandingFor(point)).toEqual(point);
	});

	it('lands a point as itself when no doc accessor is wired', () => {
		const s = createSelectionState();
		const point = { path: [0], offset: 3, cellCoordinate: true as const };
		expect(s.cellLandingFor(point)).toEqual(point);
	});

	// Out of the grid the door declines (and says so), and a landing must not invent a row.
	it('lands an out-of-grid cell index as itself', () => {
		const doc = parse(tableSource);
		const s = createSelectionState({ getDoc: () => doc });
		const point = { path: [0], offset: 99, cellCoordinate: true as const };

		expect(s.cellLandingFor(point)).toEqual(point);

		allowDevWarns(['table-endpoint-snap']);
	});
});
