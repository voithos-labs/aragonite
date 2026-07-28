import { describe, it, expect } from 'vitest';
import {
	intraTableRect,
	intraTableRectPayload
} from '../../../components/blocks/table/cell-clipboard';
import { createSelectionState } from '../../../selection/selection-state.svelte';
import type { CellSelectionPoint } from '../../../selection/primitives';
import type { Document } from '../../../core/nodes';

// A doc whose block at [0] is a table, so a same-path cross-block selection reads
// as custom-rendered. `cells` is a row-major grid of cell raws.
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

describe('intraTableRect', () => {
	const doc = tableDoc(
		[
			['a', 'b'],
			['c', 'd']
		],
		2
	);

	it('returns the shared table path and both cell indices for a live rectangle', () => {
		const sel = tableRectSelection(doc, 1, 2);
		expect(intraTableRect(sel)).toEqual({ tablePath: [0], anchorCellIdx: 1, focusCellIdx: 2 });
	});

	it('returns null when there is no cross-block selection', () => {
		const sel = createSelectionState({ getDoc: () => doc });
		expect(intraTableRect(sel)).toBeNull();
	});

	it('returns null for a linear cross-block selection across different paths', () => {
		const sel = createSelectionState({ getDoc: () => doc });
		sel.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 0 });
		expect(intraTableRect(sel)).toBeNull();
	});
});

describe('intraTableRectPayload', () => {
	// 3×2 grid: an asymmetric shape catches a row/col mix-up in the index decode —
	// a swap would address column 2 of a two-column table and change the payload.
	const doc = tableDoc(
		[
			['a', 'b'],
			['c', 'd'],
			['e', 'f']
		],
		2
	);

	it('builds the GFM sub-table for the full-grid rectangle', () => {
		const sel = tableRectSelection(doc, 0, 5);
		expect(intraTableRectPayload({ selection: sel, getDoc: () => doc })).toBe(
			'| a | b |\n| --- | --- |\n| c | d |\n| e | f |\n'
		);
	});

	it('builds a single-row rectangle from a two-cell span', () => {
		const sel = tableRectSelection(doc, 2, 3);
		expect(intraTableRectPayload({ selection: sel, getDoc: () => doc })).toBe(
			'| c | d |\n| --- | --- |\n'
		);
	});

	it('returns null when the selection is not an intra-table rectangle', () => {
		const sel = createSelectionState({ getDoc: () => doc });
		expect(intraTableRectPayload({ selection: sel, getDoc: () => doc })).toBeNull();
	});
});
