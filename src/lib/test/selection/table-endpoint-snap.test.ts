import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { normalizeTableEndpoint, cellEndpointDeepPath } from '../../selection/table-endpoint-snap';

// [0] paragraph, [1] blockquote, [2] 2-col table (header + 2 body rows).
const doc = parse('intro\n\n> quoted\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');

describe('normalizeTableEndpoint', () => {
	it('flags a deep cell path and shallows it to the table wrapper', () => {
		// [2, 2, 1] = table, row 2, col 1 → cell index 2*2 + 1 = 5.
		expect(normalizeTableEndpoint(doc, [2, 2, 1], 99)).toEqual({
			path: [2],
			offset: 5,
			cellCoordinate: true
		});
	});

	// Load-bearing: a shallow [tableIdx] path (the intra-table selection shape) is
	// returned UNFLAGGED. Intra-table cell-ness is context-established (same path +
	// table node via isCustomRendered), NOT flag-established — which is why
	// intra-table decoders read `.offset` directly instead of cellIndexOf, whose
	// flag guard would warn spuriously on these points. Flag a shallow path here
	// and every intra-table cell op starts crying wolf in DEV.
	it('leaves a shallow table-wrapper path unflagged', () => {
		expect(normalizeTableEndpoint(doc, [2], 3)).toEqual({ path: [2], offset: 3 });
	});

	it('passes a deep path with no table ancestor through unchanged', () => {
		expect(normalizeTableEndpoint(doc, [1, 0], 4)).toEqual({ path: [1, 0], offset: 4 });
	});
});

describe('cellEndpointDeepPath', () => {
	it('expands a flagged cell coordinate back to its deep [table, row, col] path', () => {
		expect(cellEndpointDeepPath(doc, { path: [2], offset: 5, cellCoordinate: true })).toEqual([
			2, 2, 1
		]);
	});

	// The intra-table rectangle's focus is unflagged by the same-path convention
	// but its offset is still a cell index. Gating on the flag left every
	// forward-extended rectangle resolving no cell, so the collapse planted the
	// caret at a character offset into the table's rendered text.
	it('expands an unflagged point on a table path — the intra-table convention', () => {
		expect(cellEndpointDeepPath(doc, { path: [2], offset: 5 })).toEqual([2, 2, 1]);
	});

	it('returns null when the path is not a table', () => {
		expect(cellEndpointDeepPath(doc, { path: [0], offset: 2 })).toBeNull();
		expect(cellEndpointDeepPath(doc, { path: [2, 1, 0], offset: 0 })).toBeNull();
	});

	// The decode used to run unchecked: offset 99 on this 2-column table produced
	// [2, 49, 1], a path to a row that does not exist, handed to revealPath as if
	// valid. Callers read null as "no deep path" and fall back to the table itself,
	// so declining is the only honest answer for an index outside the grid.
	it('returns null when the cell index falls outside the grid', () => {
		// 3 rows x 2 columns: 6 is the first index past the last cell.
		const outOfGrid = [6, 99, -1].map((offset) =>
			cellEndpointDeepPath(doc, { path: [2], offset, cellCoordinate: true })
		);
		expect(outOfGrid).toEqual([null, null, null]);
	});
});
