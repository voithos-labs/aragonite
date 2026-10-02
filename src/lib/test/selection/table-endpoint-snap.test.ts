import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { normalizeTableEndpoint, cellEndpointDeepPath } from '../../selection/table-endpoint-snap';
import { takeDevWarns } from '../support/warn-gate';

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

	// A point on the table's own path already names a cell index; only the flag is missing.
	it('flags a point on the table path, keeping its cell index', () => {
		expect(normalizeTableEndpoint(doc, [2], 3)).toEqual({
			path: [2],
			offset: 3,
			cellCoordinate: true
		});
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

	it('returns null for an unflagged point, whose offset counts characters', () => {
		expect(cellEndpointDeepPath(doc, { path: [2], offset: 5 })).toBeNull();
	});

	it('returns null when the path is not a table', () => {
		expect(cellEndpointDeepPath(doc, { path: [0], offset: 2 })).toBeNull();
		expect(cellEndpointDeepPath(doc, { path: [2, 1, 0], offset: 0 })).toBeNull();
	});

	// An unchecked decode turns offset 99 on this 2-column table into [2, 49, 1], a path to a row
	// that does not exist. Callers read null as "no deep path" and fall back to the table.
	it('returns null when the cell index falls outside the grid', () => {
		// 3 rows x 2 columns: 6 is the first index past the last cell.
		const outOfGrid = [6, 99, -1].map((offset) =>
			cellEndpointDeepPath(doc, { path: [2], offset, cellCoordinate: true })
		);
		expect(outOfGrid).toEqual([null, null, null]);
		const fires = takeDevWarns();
		expect(fires).toHaveLength(3);
		expect(fires.every((w) => w.tag === 'table-endpoint-snap')).toBe(true);
	});
});
