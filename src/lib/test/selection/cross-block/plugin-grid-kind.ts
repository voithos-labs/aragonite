// A plugin-declared grid: the grid kind, the row kind it holds, and the inline-bearing leaf a row
// holds — the shape the built-in table has, registered the way a plugin would register it, with no
// table metadata anywhere — plus the document and the stored-endpoint plan its suites press
// against. Callers own the registry reset (`__resetSchemaRegistriesForTests`).

import { parse } from '$lib/core/parser';
import type { CstNode, Document } from '$lib/core/nodes';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { planCrossBlockFormat } from '$lib/selection/cross-block/format-range';
import type { SelectionPoint } from '$lib/selection/primitives';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { testClosure } from '$lib/test/support/closure';

const joinChildren = (node: CstNode, sep: string) =>
	(node.children ?? []).map((child) => child.raw).join(sep);

export function registerPluginGrid() {
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

export type PluginGridKinds = ReturnType<typeof registerPluginGrid>;

/** A grid over `rows` of cell raws — the rows-of-cells shape the grid arm walks. */
export function gridOf(kinds: PluginGridKinds, rows: string[][]): CstNode {
	const children = rows.map((cells) => ({
		kind: kinds.row,
		leadingTrivia: '',
		raw: cells.join(' '),
		children: cells.map((raw) => ({ kind: kinds.cell, leadingTrivia: '', raw }))
	}));
	return {
		kind: kinds.grid,
		leadingTrivia: '',
		raw: children.map((row) => row.raw).join('\n') + '\n',
		children
	};
}

/** `head` / the grid / `tail`, so a grid that contributes nothing still has neighbours that do. */
export function docAround(grid: CstNode): Document {
	const doc = parse('head\n\ntail\n');
	doc.children.splice(1, 0, grid);
	return doc;
}

/** Plan from the endpoints SelectionState would store, not from a hand-built pair: a plugin
 *  grid's endpoint passes the table snap untouched, which is what puts a deep path in the plan. */
export function planStored(doc: Document, anchor: SelectionPoint, focus: SelectionPoint) {
	const selection = createSelectionState({ getDoc: () => doc });
	selection.enterCrossBlock(anchor, focus);
	return {
		start: selection.start!,
		end: selection.end!,
		plan: planCrossBlockFormat(doc, selection.start!, selection.end!, 'strong', undefined)
	};
}
