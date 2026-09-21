// @vitest-environment jsdom
//
// TableBlock's BlockComponent interface is a two-dimensional adapter behind a one-dimensional
// one, and it only works once rows and cells are mounted: `focus` collapses an offset to a corner
// cell, `getCursorPosition` reads back through the row references, and `measurePartialRects`
// chooses between a live rectangle inside the table and the plain cell range its caller asked for.
// Rectangle geometry is asserted by count, since jsdom boxes are all zero.
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
		// The same rectangle with a path this table does not own: the owner check is the
		// only thing separating these two cases, which are otherwise identical.
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

	// The two caret calls reach the same corner cell by different routes, `focus` through the
	// row's `focusByPath` and `parkCaret` through `getBlockComponentByPath`, so this keeps them
	// in step.
	it('both caret verbs land in the same corner cell', () => {
		mounted = mountTable(GRID);

		for (const offset of [0, 1]) {
			const corner = offset === 0 ? mounted.cell(0, 0) : mounted.cell(2, 1);

			mounted.block.focus(offset);
			expect(document.activeElement).toBe(corner);

			mounted.cell(1, 0).focus(); // move off, so the caret has to be placed again
			mounted.block.parkCaret!(offset);
			expect(document.activeElement).toBe(corner);
		}
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
