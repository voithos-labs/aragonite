// @vitest-environment jsdom
// What the plan hands back for a range whose edge is a deep `[grid, row, col]` path: a character
// offset into a cell the write grows, an endpoint space a table does not have. A text edge
// follows its own rewrite, and a deep grid edge must too.
// Miss-analysis: every endpoint assertion used a table endpoint, whose cell space no write moves.
import { describe, expect, it } from 'vitest';
import type { SelectionPoint } from '$lib/selection/primitives';
import { collectCrossBlockText } from '$lib/selection/clipboard-text';
import { coverRange } from '$lib/selection/range-coverage';
import { docAround, gridOf, planStored, registerPluginGrid } from './plugin-grid-kind';

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

const TWO_BY_TWO = [
	['ab', 'cd'],
	['ef', 'gh']
];

describe('a range edge deep inside a plugin grid', () => {
	it('restores the start before the opener its own cell grew', () => {
		const doc = docAround(gridOf(registerPluginGrid(), TWO_BY_TWO));

		const { plan } = planStored(doc, at([1, 0, 1], 1), at([2], 4));
		expect(plan!.writes[0]).toMatchObject({ path: [1, 0, 1], newDisplay: 'c**d**' });
		expect(plan!.startOffset).toBe(1);
	});

	// The closer lands before the end offset, so the end has to move past it.
	it('restores the end past the closer its own cell grew', () => {
		const doc = docAround(gridOf(registerPluginGrid(), TWO_BY_TWO));

		const { plan } = planStored(doc, at([0], 0), at([1, 1, 0], 1));
		expect(plan!.writes.at(-1)).toMatchObject({ path: [1, 1, 0], newDisplay: '**e**f' });
		expect(plan!.endOffset).toBe('**e**'.length);
	});

	// A cell the plan does not write moved no bytes, so its edge is still where it stood.
	it('leaves the offset alone where the endpoint’s own cell carries nothing to mark', () => {
		const doc = docAround(gridOf(registerPluginGrid(), [['ab', '  ']]));

		const { plan } = planStored(doc, at([1, 0, 1], 1), at([2], 4));
		expect(plan!.writes.map((write) => write.path)).toEqual([[2]]);
		expect(plan!.startOffset).toBe(1);
	});

	// An endpoint on the grid's own path addresses no cell, so no cell write owns its offset.
	it('leaves a char offset on the grid’s own path where it stands', () => {
		const doc = docAround(gridOf(registerPluginGrid(), TWO_BY_TWO));

		const { plan } = planStored(doc, at([1], 3), at([2], 4));
		expect(plan!.startOffset).toBe(3);
	});
});

// Miss-analysis: every row here read the format alone, so its whole-cell reading of a grid edge
// never met the copy's reading of the same range.
describe('a range starting partway into a plugin grid cell', () => {
	it('formats the bytes the copy covers, and nothing before the start', () => {
		const doc = docAround(gridOf(registerPluginGrid(), TWO_BY_TWO));

		const { start, end, plan } = planStored(doc, at([1, 0, 0], 1), at([2], 2));
		expect(plan!.writes[0]).toMatchObject({ path: [1, 0, 0], newDisplay: 'a**b**' });
		const marked = plan!.writes
			.flatMap((write) => [...write.newDisplay.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]))
			.join('');
		const copied = collectCrossBlockText(doc, coverRange(doc, start, end));
		expect(marked).toBe(copied.replace(/\s/g, ''));
	});
});
