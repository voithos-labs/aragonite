// @vitest-environment jsdom
//
// TableBlock's BlockComponent surface is a 2D adapter behind a 1D interface, and
// the seams only exist once rows and cells are mounted: `focus` collapses an
// offset to a corner cell, `getCursorPosition` reads back through the row refs,
// and `measurePartialRects` decides between a live intra-table rectangle and the
// plain cell range its caller asked for — a decision that turns on whether the
// rectangle belongs to THIS table.
//
// Rect geometry is asserted by COUNT, not coordinates: jsdom gives every element
// the same zero box, so which cells were measured is only visible in how many.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { SELECTION_END } from '$lib/block-component';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import type { CellSelectionPoint } from '$lib/selection/primitives';
import { installTableLayoutStubs, mountTable, type MountedTable } from './mount-table';

let restoreLayout: () => void;
beforeAll(() => {
	restoreLayout = installTableLayoutStubs();
	return () => restoreLayout();
});

let mounted: MountedTable | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

// 3 rows × 2 columns = 6 cells, indices 0..5 row-major.
const GRID = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

/** A live intra-table rectangle over rows 0–1 × both columns, on `tablePath`. */
function selectionWithRect(tablePath: number[]) {
	const selection = createSelectionState();
	selection.enterCrossBlock(
		{ path: tablePath, offset: 0, cellCoordinate: true } as CellSelectionPoint,
		{
			path: tablePath,
			offset: 3
		}
	);
	return selection;
}

describe('measurePartialRects answers for this table’s cells only', () => {
	it('measures the plain cell range when no rectangle is live', () => {
		mounted = mountTable(GRID);

		expect(mounted.block.measurePartialRects(0, 2)).toHaveLength(2);
		expect(mounted.block.measurePartialRects(0, SELECTION_END)).toHaveLength(6);
	});

	it('measures the rectangle instead when the live one is this table’s', () => {
		mounted = mountTable(GRID, { services: { selection: selectionWithRect([0]) } });

		// The rectangle covers 4 cells; the requested range covers 1. The rectangle wins.
		expect(mounted.block.measurePartialRects(0, 1)).toHaveLength(4);
	});

	it('leaves the requested range intact when the rectangle belongs to another table', () => {
		// Same rectangle, a path this table does not own — the owner check is the
		// only thing separating these two cases, and both shapes are otherwise equal.
		mounted = mountTable(GRID, { services: { selection: selectionWithRect([7]) } });

		expect(mounted.block.measurePartialRects(0, 1)).toHaveLength(1);
	});

	it('clamps a range that runs past the last cell', () => {
		mounted = mountTable(GRID);

		expect(mounted.block.measurePartialRects(4, 99)).toHaveLength(2);
	});
});

describe('the table addresses its own cells for focus and geometry', () => {
	it('collapses focus(0) to the first cell and any other offset to the last', () => {
		mounted = mountTable(GRID);

		mounted.block.focus(0);
		expect(document.activeElement).toBe(mounted.cell(0, 0));

		mounted.block.focus(1);
		expect(document.activeElement).toBe(mounted.cell(2, 1));
	});

	it('reaches an interior cell through the deep path', () => {
		mounted = mountTable(GRID);

		mounted.block.focusByPath!([1, 1], 0);

		expect(document.activeElement).toBe(mounted.cell(1, 1));
	});

	it('reports no cursor position until a cell reports focus', () => {
		mounted = mountTable(GRID);
		expect(mounted.block.getCursorPosition!()).toBeNull();

		mounted.cell(1, 0).focus();

		expect(mounted.block.getCursorPosition!()?.path).toEqual([1, 0]);
	});

	it('resolves a cell component by path and declines an out-of-grid one', () => {
		mounted = mountTable(GRID);

		expect(mounted.block.getBlockComponentByPath!([1, 1])?.editable).toBe(true);
		expect(mounted.block.getBlockComponentByPath!([9, 0])).toBeNull();
	});

	it('measures a cell rect in range and declines one outside the grid', () => {
		mounted = mountTable(GRID);

		expect(mounted.block.cellRect(2, 1)).not.toBeNull();
		expect(mounted.block.cellRect(3, 0)).toBeNull();
		expect(mounted.block.cellRect(0, 2)).toBeNull();
	});
});
