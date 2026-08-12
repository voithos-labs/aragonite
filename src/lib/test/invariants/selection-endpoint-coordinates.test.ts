import { describe, expect, it } from 'vitest';

import { takeDevWarns } from '../support/warn-gate';
import { parse } from '../../core/parser';
import { checkCrossBlockEndpointCoordinates } from '../../invariants/selection-endpoints';
import { createSelectionState } from '../../selection/selection-state.svelte';

// A table block plus a paragraph — [0] is the table, [1] the prose.
const doc = () => parse('| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter\n');

describe('G1.29 cross-block endpoint coordinates', () => {
	it('flags a table endpoint carrying a character offset', () => {
		const violation = checkCrossBlockEndpointCoordinates(
			doc(),
			{ path: [0], offset: 5 },
			{ path: [1], offset: 0 }
		);
		expect(violation?.code).toBe('endpoint-cell-coordinate');
		expect(violation?.message).toContain('anchor');
	});

	it('passes a flagged table endpoint', () => {
		const cell = { path: [0], offset: 1, cellCoordinate: true };
		expect(checkCrossBlockEndpointCoordinates(doc(), cell, { path: [1], offset: 0 })).toBeNull();
	});

	// An intra-table rectangle shares the table path and leaves its focus unflagged
	// by the SelectionPoint convention — the offsets are cell indices regardless.
	it('exempts a same-path pair', () => {
		expect(
			checkCrossBlockEndpointCoordinates(doc(), { path: [0], offset: 0 }, { path: [0], offset: 3 })
		).toBeNull();
	});

	it('ignores endpoints that resolve to prose or to nothing', () => {
		expect(
			checkCrossBlockEndpointCoordinates(doc(), { path: [1], offset: 2 }, { path: [9], offset: 0 })
		).toBeNull();
	});

	it('flags the focus side too', () => {
		const violation = checkCrossBlockEndpointCoordinates(
			doc(),
			{ path: [1], offset: 0 },
			{ path: [0], offset: 5 }
		);
		expect(violation?.message).toContain('focus');
	});
});

// A thematic break is the built-in kind with no character positions: `---\n` admits
// offsets 0 and 3 and nothing between.
const breakDoc = () => parse('above\n\n---\n\nbelow\n');

describe('G1.29 character-offset range', () => {
	it('flags an offset past the end of the block raw', () => {
		const violation = checkCrossBlockEndpointCoordinates(
			breakDoc(),
			{ path: [0], offset: 6 },
			{ path: [2], offset: 0 }
		);
		expect(violation?.code).toBe('endpoint-offset-out-of-range');
		expect(violation?.message).toContain('anchor');
	});

	it('passes an offset at the display end', () => {
		expect(
			checkCrossBlockEndpointCoordinates(
				breakDoc(),
				{ path: [0], offset: 5 },
				{ path: [2], offset: 0 }
			)
		).toBeNull();
	});

	it('flags an interior offset inside a whole-block kind', () => {
		const violation = checkCrossBlockEndpointCoordinates(
			breakDoc(),
			{ path: [0], offset: 0 },
			{ path: [1], offset: 1 }
		);
		expect(violation?.code).toBe('endpoint-whole-block-offset');
		expect(violation?.message).toContain('focus');
	});

	it('passes both ends of a whole-block kind', () => {
		for (const offset of [0, 3]) {
			expect(
				checkCrossBlockEndpointCoordinates(
					breakDoc(),
					{ path: [1], offset },
					{ path: [2], offset: 0 }
				)
			).toBeNull();
		}
	});
});

// #normalizePoint's walk runs `path.length - 1` iterations, so a length-1 table path
// passes through with its character offset intact — the shape the belt exists for.
describe('G1.29 fires from the storing seam', () => {
	it('warns when a length-1 table path is stored with a character offset', () => {
		const tree = doc();
		const selection = createSelectionState({ getDoc: () => tree });

		selection.enterCrossBlock({ path: [0], offset: 5 }, { path: [1], offset: 0 });

		expect(takeDevWarns().map((w) => w.tag)).toEqual([
			'invariant:cross-block-endpoint-coordinates'
		]);
	});

	it('stays silent when the funnel snapped a whole-block endpoint', () => {
		const tree = breakDoc();
		const selection = createSelectionState({ getDoc: () => tree });

		selection.enterCrossBlock({ path: [0], offset: 2 }, { path: [1], offset: 1 });

		expect(selection.end).toEqual({ path: [1], offset: 3 });
		expect(takeDevWarns()).toEqual([]);
	});

	it('stays silent for a normalized cell endpoint', () => {
		const tree = doc();
		const selection = createSelectionState({ getDoc: () => tree });

		selection.enterCrossBlock(
			{ path: [0], offset: 1, cellCoordinate: true },
			{ path: [1], offset: 0 }
		);

		expect(takeDevWarns()).toEqual([]);
	});
});
