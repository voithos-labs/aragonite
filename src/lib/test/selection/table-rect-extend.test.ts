import { describe, it, expect } from 'vitest';
import { intraTableRectExtension, type ArrowKey } from '../../selection/table-rect-extend';
import type { DocumentView } from '../../core/node-views';
import type { SelectionPoint } from '../../selection/primitives';

// 3-col table with `rows` rows (children length drives rowCount).
function tableDoc(cols = 3, rows = 4): DocumentView {
	return {
		kind: 'document',
		prefix: '',
		suffix: '',
		children: [
			{
				kind: 'table',
				leadingTrivia: '',
				raw: '',
				metadata: { columnCount: cols, alignments: Array(cols).fill('none') },
				children: Array.from({ length: rows }, () => ({
					kind: 'tableRow',
					leadingTrivia: '',
					raw: '',
					children: []
				}))
			}
		]
	} as unknown as DocumentView;
}

const at = (offset: number): SelectionPoint => ({ path: [0], offset });
const extend = (doc: DocumentView, offset: number, key: ArrowKey) =>
	intraTableRectExtension(doc, at(offset), at(offset), key);

describe('intraTableRectExtension', () => {
	const doc = tableDoc(3, 4); // cells 0..11

	it('extends down one whole row (not the next doc-order cell)', () => {
		// cellIdx 4 = row 1, col 1 → down a row is cellIdx 7, not cellIdx 5.
		expect(extend(doc, 4, 'ArrowDown')).toEqual({ kind: 'cell', offset: 7 });
	});

	it('exits forward at the last row', () => {
		// cellIdx 10 = row 3 (last), col 1. fromCellPath is the table's last cell so
		// the leaf walk steps out of the table entirely.
		expect(extend(doc, 10, 'ArrowDown')).toEqual({
			kind: 'exit',
			direction: 'forward',
			fromCellPath: [0, 3, 2]
		});
	});

	it('extends up one whole row and exits backward at the first row', () => {
		expect(extend(doc, 7, 'ArrowUp')).toEqual({ kind: 'cell', offset: 4 });
		expect(extend(doc, 1, 'ArrowUp')).toEqual({
			kind: 'exit',
			direction: 'backward',
			fromCellPath: [0, 0, 0]
		});
	});

	it('extends a column horizontally and clamps at the edges (no sideways exit)', () => {
		expect(extend(doc, 4, 'ArrowRight')).toEqual({ kind: 'cell', offset: 5 });
		expect(extend(doc, 5, 'ArrowRight')).toEqual({ kind: 'cell', offset: 5 }); // last col clamps
		expect(extend(doc, 4, 'ArrowLeft')).toEqual({ kind: 'cell', offset: 3 });
		expect(extend(doc, 3, 'ArrowLeft')).toEqual({ kind: 'cell', offset: 3 }); // first col clamps
	});

	it('returns null when the endpoints are not on one table', () => {
		const nonTable = {
			kind: 'document',
			prefix: '',
			suffix: '',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'x' }]
		} as unknown as DocumentView;
		expect(intraTableRectExtension(nonTable, at(0), at(0), 'ArrowDown')).toBeNull();
		// Different paths — a cross-block selection, not an intra-table rectangle.
		expect(
			intraTableRectExtension(doc, { path: [0], offset: 4 }, { path: [1], offset: 0 }, 'ArrowDown')
		).toBeNull();
	});
});
