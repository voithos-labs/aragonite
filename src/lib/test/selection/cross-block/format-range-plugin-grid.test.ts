// @vitest-environment jsdom
//
// A plugin grid inside a cross-block format range. `containerContract: 'grid'` is a declarable
// plugin contract, so the toggle's grid arm is reached by kinds carrying no table metadata: it
// must read the grid's own shape, never throw out of either door, and leave the blocks around it
// marked.
//
// Miss-analysis: the arm was written against the only two grids that exist, both built-in, and
// every case fed it a parsed table — no suite's corpus held a grid the table metadata is absent on.
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import {
	setPluginMetadata,
	type CstNode,
	type Document,
	type PluginBlockKind
} from '$lib/core/nodes';
import { createSharingState } from '$lib/tree-operations/sharing';
import {
	applyCrossBlockFormat,
	crossBlockActiveFormats,
	planCrossBlockFormat
} from '$lib/selection/cross-block/format-range';
import type { SelectionPoint } from '$lib/selection/primitives';
import { testClosure } from '$lib/test/support/closure';

afterEach(() => __resetSchemaRegistriesForTests());

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

const joinChildren = (node: CstNode, sep: string) =>
	(node.children ?? []).map((child) => child.raw).join(sep);

/** A grid kind, the row kind it holds, and the inline-bearing leaf a row holds — the shape the
 *  built-in table has, registered the way a plugin would register it. */
function registerPluginGrid() {
	const grid = declarePluginKind('pluginGrid');
	const row = declarePluginKind('pluginGridRow');
	const cell = declarePluginKind('pluginGridCell');
	const base = { gapEdges: 'none', mergeRole: 'not-mergeable', closure: testClosure } as const;
	registerBlockKind(grid, {
		...base,
		editable: true,
		supportsInline: false,
		container: {
			contract: 'grid',
			rebuildRaw: (node) => {
				node.raw = joinChildren(node, '\n') + '\n';
			}
		}
	});
	registerBlockKind(row, {
		...base,
		editable: true,
		supportsInline: false,
		container: {
			contract: 'grid',
			rebuildRaw: (node) => {
				node.raw = joinChildren(node, ' ');
			}
		}
	});
	registerBlockKind(cell, { ...base, editable: true, supportsInline: true });
	return { grid, row, cell };
}

/** `head` / the grid / `tail`, so a grid that contributes nothing still has neighbours that do. */
function docAround(grid: CstNode): Document {
	const doc = parse('head\n\ntail\n');
	doc.children.splice(1, 0, grid);
	return doc;
}

const leaf = (kind: PluginBlockKind, raw: string): CstNode => ({ kind, leadingTrivia: '', raw });

describe('a grid whose kind carries no table metadata', () => {
	it('contributes its cells instead of throwing out of the plan', () => {
		const kinds = registerPluginGrid();
		const doc = docAround({
			kind: kinds.grid,
			leadingTrivia: '',
			raw: 'a b\n',
			children: [
				{
					kind: kinds.row,
					leadingTrivia: '',
					raw: 'a b',
					children: [leaf(kinds.cell, 'a'), leaf(kinds.cell, 'b')]
				}
			]
		});

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
		const kinds = registerPluginGrid();
		const grid: CstNode = {
			kind: kinds.grid,
			leadingTrivia: '',
			raw: 'a b\n',
			children: [
				{
					kind: kinds.row,
					leadingTrivia: '',
					raw: 'a b',
					children: [leaf(kinds.cell, 'a'), leaf(kinds.cell, 'b')]
				}
			]
		};
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
			children: [leaf(kinds.cell, 'a')]
		});

		const plan = planCrossBlockFormat(doc, at([0], 0), at([2], 4), 'strong', undefined)!;
		expect(plan.writes.map((write) => write.path)).toEqual([[0], [2]]);
	});

	it('answers the pressed read over the same range rather than throwing', () => {
		const kinds = registerPluginGrid();
		const doc = docAround({
			kind: kinds.grid,
			leadingTrivia: '',
			raw: 'a b\n',
			children: [
				{
					kind: kinds.row,
					leadingTrivia: '',
					raw: '**a** **b**',
					children: [leaf(kinds.cell, '**a**'), leaf(kinds.cell, '**b**')]
				}
			]
		});
		doc.children[0].raw = '**head**\n';
		doc.children[2].raw = '**tail**\n';

		expect(crossBlockActiveFormats(doc, at([0], 0), at([2], 8)).has('strong')).toBe(true);
	});
});
