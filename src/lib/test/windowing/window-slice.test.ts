import { describe, it, expect } from 'vitest';
import { windowSlicer } from '../../windowing/window-slice';
import type { WindowResult } from '../../windowing/block-window.svelte';

const active = (start: number, end: number): WindowResult => ({
	active: true,
	start,
	end,
	topSpacerPx: 0,
	bottomSpacerPx: 0,
	floorPx: 0
});

const children = (n: number) => Array.from({ length: n }, (_, i) => `node${i}`);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`);

const sliceWindow = (nodes: string[], keys: string[], win: WindowResult | undefined) =>
	windowSlicer<string>()(nodes, keys, win);

function range(n: number, win: WindowResult | undefined) {
	const { start, end } = sliceWindow(children(n), ids(n), win);
	return { start, end };
}

describe('windowSlicer', () => {
	it('returns the full range when the window is inactive or absent', () => {
		expect(range(10, undefined)).toEqual({ start: 0, end: 10 });
		expect(range(10, { ...active(2, 5), active: false })).toEqual({ start: 0, end: 10 });
	});

	it('clamps the range to the child count (a stale window must never over-slice)', () => {
		expect(range(5, active(2, 99))).toEqual({ start: 2, end: 5 });
		expect(range(3, active(10, 20))).toEqual({ start: 3, end: 3 });
	});

	// A stale window with `end < start` collapses to an empty range, never a negative one (VR-14).
	it('collapses an inverted window to an empty slice at start', () => {
		expect(sliceWindow(children(100), ids(100), active(30, 10))).toEqual({
			start: 30,
			end: 30,
			entries: []
		});
	});

	it('gives each mounted child its absolute index and its own id', () => {
		expect(sliceWindow(children(100), ids(100), active(18, 20)).entries).toEqual([
			{ node: 'node18', index: 18, id: 'id18' },
			{ node: 'node19', index: 19, id: 'id19' }
		]);
	});

	// A fresh entry for every mounted child on every recompute re-runs each child's prop reads.
	it('hands back the last entry for a child whose node and index held, and a new one for an edited node', () => {
		const slice = windowSlicer<string>();
		const before = slice(children(10), ids(10), active(2, 5)).entries;
		const nodes = children(10);
		nodes[3] = 'edited';
		const after = slice(nodes, ids(10), active(2, 5)).entries;
		expect(after[0]).toBe(before[0]);
		expect(after[1]).not.toBe(before[1]);
		expect(after[1]).toEqual({ node: 'edited', index: 3, id: 'id3' });
	});

	// Miss-analysis: no test shifted a child while its node and id held, so a reuse check that
	// skipped the index passed every row here while an insert above left stale paths on screen.
	it('gives a child an insert above shifted a new entry at its new index', () => {
		const slice = windowSlicer<string>();
		const before = slice(children(10), ids(10), active(2, 5)).entries;
		const after = slice(['new', ...children(10)], ['idNew', ...ids(10)], active(2, 5)).entries;
		expect(after[1]).not.toBe(before[0]);
		expect(after[1]).toEqual({ node: 'node2', index: 3, id: 'id2' });
	});
});
