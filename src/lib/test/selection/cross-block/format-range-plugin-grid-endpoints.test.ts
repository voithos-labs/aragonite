// @vitest-environment jsdom
//
// What the plan hands back for a range whose edge is a deep `[grid, row, col]` path: a CHAR offset
// into a cell the write grows, an endpoint space a table does not have. A prose edge follows its
// own rewrite; this is the sibling that did not.
//
// Miss-analysis: every endpoint assertion in these suites used a table endpoint, whose cell-index
// space no write can move, so none asked what a char-offset endpoint reads after its cell grew.
import { afterEach, describe, expect, it } from 'vitest';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import type { SelectionPoint } from '$lib/selection/primitives';
import { docAround, gridOf, planStored, registerPluginGrid } from './plugin-grid-kind';

afterEach(() => __resetSchemaRegistriesForTests());

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

const TWO_BY_TWO = [
	['ab', 'cd'],
	['ef', 'gh']
];

describe('a range edge deep inside a plugin grid', () => {
	it('restores the start over the cell the press marked, not at its pre-write offset', () => {
		const doc = docAround(gridOf(registerPluginGrid(), TWO_BY_TWO));

		const { plan } = planStored(doc, at([1, 0, 1], 1), at([2], 4));
		expect(plan!.writes[0]).toMatchObject({ path: [1, 0, 1], newDisplay: '**cd**' });
		expect(plan!.startOffset).toBe(0);
	});

	// The same staleness at the other edge, where it under-reaches instead: the closer lands after
	// the content the end offset names.
	it('restores the end past the closer its own cell grew', () => {
		const doc = docAround(gridOf(registerPluginGrid(), TWO_BY_TWO));

		const { plan } = planStored(doc, at([0], 0), at([1, 1, 0], 1));
		expect(plan!.writes.at(-1)).toMatchObject({ path: [1, 1, 0], newDisplay: '**ef**' });
		expect(plan!.endOffset).toBe('**ef**'.length);
	});

	// A cell the plan does not write moved no bytes, so its edge is still where it stood.
	it('leaves the offset alone where the endpoint’s own cell carries nothing to mark', () => {
		const doc = docAround(gridOf(registerPluginGrid(), [['ab', '  ']]));

		const { plan } = planStored(doc, at([1, 0, 1], 1), at([2], 4));
		expect(plan!.writes.map((write) => write.path)).toEqual([[2]]);
		expect(plan!.startOffset).toBe(1);
	});

	// An endpoint on the grid's OWN path addresses no cell, so no cell write owns its offset.
	it('leaves a char offset on the grid’s own path where it stands', () => {
		const doc = docAround(gridOf(registerPluginGrid(), TWO_BY_TWO));

		const { plan } = planStored(doc, at([1], 3), at([2], 4));
		expect(plan!.startOffset).toBe(3);
	});
});
