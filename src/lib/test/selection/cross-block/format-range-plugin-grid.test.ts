// @vitest-environment jsdom
//
// A plugin grid inside a cross-block format range. `containerContract: 'grid'` is a declarable
// plugin contract, so the toggle's grid arm is reached by kinds with no table metadata, whose
// endpoints never snap to cell space: a range edge inside one arrives as a deep `[grid, row, col]`
// path.
//
// Miss-analysis: every case fed the arm a parsed table with the grid WHOLLY inside the range, so
// neither a metadata-free grid nor an endpoint inside one was ever put to it.
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { setPluginMetadata, type CstNode, type Document } from '$lib/core/nodes';
import { createSharingState } from '$lib/tree-operations/sharing';
import {
	applyCrossBlockFormat,
	crossBlockActiveFormats,
	planCrossBlockFormat
} from '$lib/selection/cross-block/format-range';
import type { SelectionPoint } from '$lib/selection/primitives';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { gridOf, registerPluginGrid } from './plugin-grid-kind';

afterEach(() => __resetSchemaRegistriesForTests());

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

/** `head` / the grid / `tail`, so a grid that contributes nothing still has neighbours that do. */
function docAround(grid: CstNode): Document {
	const doc = parse('head\n\ntail\n');
	doc.children.splice(1, 0, grid);
	return doc;
}

/** Plan from the endpoints SelectionState would store, not from a hand-built pair: a plugin
 *  grid's endpoint passes the table snap untouched, which is what puts a deep path in the plan. */
function planStored(doc: Document, anchor: SelectionPoint, focus: SelectionPoint) {
	const selection = createSelectionState({ getDoc: () => doc });
	selection.enterCrossBlock(anchor, focus);
	return {
		start: selection.start!,
		end: selection.end!,
		plan: planCrossBlockFormat(doc, selection.start!, selection.end!, 'strong', undefined)
	};
}

describe('a grid whose kind carries no table metadata', () => {
	it('contributes its cells instead of throwing out of the plan', () => {
		const doc = docAround(gridOf(registerPluginGrid(), [['a', 'b']]));

		const plan = planCrossBlockFormat(doc, at([0], 0), at([2], 4), 'strong', undefined)!;
		expect(plan.writes.map((write) => [write.path, write.newDisplay])).toEqual([
			[[0], '**head**'],
			[[1, 0, 0], '**a**'],
			[[1, 0, 1], '**b**'],
			[[2], '**tail**']
		]);
		expect(() => applyCrossBlockFormat(doc, plan, createSharingState(), undefined)).not.toThrow();
	});

	// The other half of the same bug: metadata present but holding a shape of the plugin's own,
	// where the column count read is `undefined` rather than a throw.
	it('reads its own rows when the metadata belongs to the plugin', () => {
		const grid = gridOf(registerPluginGrid(), [['a', 'b']]);
		setPluginMetadata(grid, { label: 'mine' });

		const plan = planCrossBlockFormat(
			docAround(grid),
			at([0], 0),
			at([2], 4),
			'strong',
			undefined
		)!;
		expect(plan.writes.map((write) => write.path)).toEqual([[0], [1, 0, 0], [1, 0, 1], [2]]);
	});

	// The arm walks rows and their cells. A grid holding leaves directly declares no such shape,
	// so it contributes nothing — the pre-arm behaviour, and not a throw or an empty grid's NaN.
	it('contributes nothing, and blocks nothing, when its children hold no cells', () => {
		const kinds = registerPluginGrid();
		const doc = docAround({
			kind: kinds.grid,
			leadingTrivia: '',
			raw: 'a\n',
			children: [{ kind: kinds.cell, leadingTrivia: '', raw: 'a' }]
		});

		const plan = planCrossBlockFormat(doc, at([0], 0), at([2], 4), 'strong', undefined)!;
		expect(plan.writes.map((write) => write.path)).toEqual([[0], [2]]);
	});

	it('answers the pressed read over the same range rather than throwing', () => {
		const doc = docAround(gridOf(registerPluginGrid(), [['**a**', '**b**']]));
		doc.children[0].raw = '**head**\n';
		doc.children[2].raw = '**tail**\n';

		expect(crossBlockActiveFormats(doc, at([0], 0), at([2], 8)).has('strong')).toBe(true);
	});
});

describe('a range endpoint deep inside a plugin grid', () => {
	const TWO_BY_TWO = [
		['a', 'b'],
		['c', 'd']
	];

	it('runs to the end endpoint’s own cell instead of covering every cell', () => {
		const doc = docAround(gridOf(registerPluginGrid(), TWO_BY_TWO));

		// A row-1 endpoint, so the index arithmetic is `row * width + col` and not `row + col`.
		const { end, plan } = planStored(doc, at([0], 0), at([1, 1, 0], 1));
		// The premise the arm has to survive: no snap moved this endpoint into cell space.
		expect(end).toEqual({ path: [1, 1, 0], offset: 1 });
		expect(plan!.writes.map((write) => write.path)).toEqual([[0], [1, 0, 0], [1, 0, 1], [1, 1, 0]]);
	});

	it('runs from the start endpoint’s own cell instead of contributing nothing', () => {
		const doc = docAround(gridOf(registerPluginGrid(), TWO_BY_TWO));

		const { start, plan } = planStored(doc, at([1, 0, 1], 0), at([2], 4));
		expect(start).toEqual({ path: [1, 0, 1], offset: 0 });
		expect(plan!.writes.map((write) => write.path)).toEqual([[1, 0, 1], [1, 1, 0], [1, 1, 1], [2]]);
	});

	// Both endpoints inside one grid is the rectangle arm, reached through the same resolution —
	// the pair a drag inside a plugin grid stores, where a table's would share the table path.
	it('marks the rectangle two deep endpoints span', () => {
		const doc = docAround(
			gridOf(registerPluginGrid(), [
				['a', 'b', 'c'],
				['d', 'e', 'f']
			])
		);

		const { plan } = planStored(doc, at([1, 0, 1], 0), at([1, 1, 1], 1));
		expect(plan!.writes.map((write) => write.path)).toEqual([
			[1, 0, 1],
			[1, 1, 1]
		]);
	});

	// The pressed read decomposes the same range, so it inherits the fix: the cells past the
	// endpoint must not vote the toolbar's paint off.
	it('reads pressed from the covered cells alone', () => {
		const doc = docAround(
			gridOf(registerPluginGrid(), [
				['**a**', 'b'],
				['c', 'd']
			])
		);
		doc.children[0].raw = '**head**\n';

		expect(crossBlockActiveFormats(doc, at([0], 0), at([1, 0, 0], 1)).has('strong')).toBe(true);
	});

	// An endpoint ON the grid's own path counts cells only where the path IS cell space. A plugin
	// grid rendering one surface over its cells lands a CHAR offset there, which addresses no cell.
	it('reads a char offset on the grid’s own path as the grid’s edge, not as a cell index', () => {
		const doc = docAround(gridOf(registerPluginGrid(), TWO_BY_TWO));

		const { plan } = planStored(doc, at([1], 3), at([2], 4));
		expect(plan!.writes.map((write) => write.path)).toEqual([
			[1, 0, 0],
			[1, 0, 1],
			[1, 1, 0],
			[1, 1, 1],
			[2]
		]);
	});
});

// Row 0's width is the whole grid's, so a wider later row has cells no index reaches. Asserted
// rather than left implied: every other fixture here is rectangular, where any width read agrees.
describe('a grid whose rows differ in width', () => {
	const RAGGED = [
		['a', 'b'],
		['c', 'd'],
		['e', 'f', 'g']
	];

	it('never writes the surplus cell of a wider row', () => {
		const doc = docAround(gridOf(registerPluginGrid(), RAGGED));

		const plan = planCrossBlockFormat(doc, at([0], 0), at([2], 4), 'strong', undefined)!;
		expect(plan.writes.map((write) => write.path)).toEqual([
			[0],
			[1, 0, 0],
			[1, 0, 1],
			[1, 1, 0],
			[1, 1, 1],
			[1, 2, 0],
			[1, 2, 1],
			[2]
		]);
	});

	// The endpoint IS the surplus cell, and its index is still row 0's width — which puts it past
	// the grid's last index, so the run stops at the last cell the space does reach.
	it('resolves a deep endpoint through row 0’s width, past the grid’s end', () => {
		const doc = docAround(gridOf(registerPluginGrid(), RAGGED));

		const { plan } = planStored(doc, at([0], 0), at([1, 2, 2], 1));
		expect(plan!.writes.map((write) => write.path)).toEqual([
			[0],
			[1, 0, 0],
			[1, 0, 1],
			[1, 1, 0],
			[1, 1, 1],
			[1, 2, 0],
			[1, 2, 1]
		]);
	});
});
