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

	it('returns null for an unflagged point (its path is already a leaf)', () => {
		expect(cellEndpointDeepPath(doc, { path: [2], offset: 5 })).toBeNull();
	});
});
