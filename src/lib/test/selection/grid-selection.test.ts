import { describe, it, expect } from 'vitest';
import { gridClipboard } from '../../selection/grid-selection';
import { createSelectionState } from '../../selection/selection-state.svelte';
import type { CellSelectionPoint } from '../../selection/primitives';
import type { Document } from '../../core/nodes';
import { coverRange, rangeCoverage, type GridCoverage } from '../../selection/range-coverage';
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

	const payload = (anchor: number, focus: number) => {
		const sel = tableRectSelection(doc, anchor, focus);
		return gridClipboard(doc, rangeCoverage(doc, coverRange(doc, sel.anchor!, sel.focus!)).grid!);
	};

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
