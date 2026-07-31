import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../dev-warn', () => ({ devWarn: vi.fn() }));
import { devWarn } from '../../dev-warn';
import { parse } from '../../core/parser';
import { checkCrossBlockEndpointCoordinates } from '../../invariants/selection-endpoints';
import { createSelectionState } from '../../selection/selection-state.svelte';

afterEach(() => vi.unstubAllEnvs());

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

// #normalizePoint's walk runs `path.length - 1` iterations, so a length-1 table path
// passes through with its character offset intact — the shape the belt exists for.
describe('G1.29 fires from the storing seam', () => {
	it('warns when a length-1 table path is stored with a character offset', () => {
		vi.stubEnv('DEV', true);
		const tree = doc();
		const selection = createSelectionState({ getDoc: () => tree });
		vi.mocked(devWarn).mockClear();

		selection.enterCrossBlock({ path: [0], offset: 5 }, { path: [1], offset: 0 });

		expect(
			vi
				.mocked(devWarn)
				.mock.calls.some(([tag]) => tag === 'invariant:cross-block-endpoint-coordinates')
		).toBe(true);
	});

	it('stays silent for a normalized cell endpoint', () => {
		vi.stubEnv('DEV', true);
		const tree = doc();
		const selection = createSelectionState({ getDoc: () => tree });
		vi.mocked(devWarn).mockClear();

		selection.enterCrossBlock(
			{ path: [0], offset: 1, cellCoordinate: true },
			{ path: [1], offset: 0 }
		);

		expect(
			vi
				.mocked(devWarn)
				.mock.calls.some(([tag]) => tag === 'invariant:cross-block-endpoint-coordinates')
		).toBe(false);
	});
});
