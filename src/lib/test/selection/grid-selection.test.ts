import { describe, it, expect } from 'vitest';
import { gridClipboard, liveGrid } from '../../selection/grid-selection';
import { createSelectionState } from '../../selection/selection-state.svelte';
import type { CellSelectionPoint } from '../../selection/primitives';
import type { Document } from '../../core/nodes';
import type { GridCoverage } from '../../selection/range-coverage';
import { asDocPath } from '../../selection/path-math';

// A document whose block at [0] is a table, so a cross-block selection with the same path on
// both ends reads as custom-rendered. `cells` is a row-major grid of cell raws.
function tableDoc(cells: string[][], columnCount: number): Document {
	return {
		kind: 'document',
		prefix: '',
		suffix: '',
		children: [
			{
				kind: 'table',
				leadingTrivia: '',
				raw: '',
				metadata: { columnCount, alignments: Array(columnCount).fill('none') },
				children: cells.map((row) => ({
					kind: 'tableRow',
					leadingTrivia: '',
					raw: '',
					children: row.map((raw) => ({ kind: 'tableCell', leadingTrivia: '', raw, children: [] }))
				}))
			}
		]
	} as unknown as Document;
}

function tableRectSelection(doc: Document, anchorIdx: number, focusIdx: number) {
	const sel = createSelectionState({ getDoc: () => doc });
	sel.enterCrossBlock(
		{ path: [0], offset: anchorIdx, cellCoordinate: true } satisfies CellSelectionPoint,
		{ path: [0], offset: focusIdx }
	);
	return sel;
}

describe('liveGrid', () => {
	const doc = tableDoc(
		[
			['a', 'b'],
			['c', 'd']
		],
		2
	);

	it('returns the table path and the rectangle the two cells span', () => {
		const sel = tableRectSelection(doc, 1, 2);
		expect(liveGrid(sel, doc)).toEqual({
			kind: 'table',
			path: [0],
			rect: { top: 0, left: 0, rows: 2, cols: 2 }
		});
	});

	it('returns null when there is no cross-block selection', () => {
		const sel = createSelectionState({ getDoc: () => doc });
		expect(liveGrid(sel, doc)).toBeNull();
	});

	it('returns null for a linear cross-block selection across different paths', () => {
		const sel = createSelectionState({ getDoc: () => doc });
		sel.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 0 });
		expect(liveGrid(sel, doc)).toBeNull();
	});
});

describe('gridClipboard', () => {
	// A 3x2 grid: an uneven shape catches a row-and-column mix-up in the index decoding,
	// since a swap would address column 2 of a two-column table and change the payload.
	const doc = tableDoc(
		[
			['a', 'b'],
			['c', 'd'],
			['e', 'f']
		],
		2
	);

	const payload = (anchor: number, focus: number) =>
		gridClipboard(doc, liveGrid(tableRectSelection(doc, anchor, focus), doc)!);

	it('builds the GFM sub-table for the full-grid rectangle', () => {
		expect(payload(0, 5)?.text).toBe('| a | b |\n| --- | --- |\n| c | d |\n| e | f |\n');
	});

	it('builds a single-row rectangle from a two-cell span', () => {
		expect(payload(2, 3)?.text).toBe('| c | d |\n| --- | --- |\n');
	});

	it('writes the same cells as an HTML table', () => {
		expect(payload(2, 3)?.html).toContain('<tr><td>c</td><td>d</td></tr>');
	});

	it('returns null for one cell, whose copy is its own text', () => {
		const grid: GridCoverage = {
			kind: 'cells',
			path: asDocPath([0]),
			rect: { top: 1, left: 1, rows: 1, cols: 1 }
		};
		expect(gridClipboard(doc, grid)).toBeNull();
	});
});
