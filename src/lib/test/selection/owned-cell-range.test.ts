// @vitest-environment jsdom
// A finger's word in a table cell is the editor's range at the cell's own path, held only while both
// ends sit in that cell, and an edit over it leaves the cell a cell.
import { describe, it, expect } from 'vitest';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { fingerPress, type FingerPress } from '#lib/selection/pointer-gesture.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { checkCellTextEndpoint } from '#lib/invariants/cell-text-endpoint.js';
import { cell, rangeKey, rangeKeyEnv } from './cross-block/range-key-env';

const TABLE = '| apple pie | berry |\n| --- | --- |\n| cherry | damson |\n';
const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });
const finger = (): FingerPress => fingerPress({ pointerType: 'touch', pointerId: 1 })!;
const APPLE = { anchor: at([0, 0, 0], 0), focus: at([0, 0, 0], 5) };

function stateOver(source: string) {
	const doc = parse(source);
	return createSelectionState({ getDoc: () => doc });
}

describe("the state a finger's word in a cell leaves", () => {
	it("keeps the cell's path and offsets, painted, as a range inside one block", () => {
		const selection = stateOver(TABLE);
		selection.ownBlockRange(APPLE.anchor, APPLE.focus, finger());
		expect([selection.anchor, selection.focus]).toEqual([APPLE.anchor, APPLE.focus]);
		expect([selection.isCustomRendered, selection.rangeInOneBlock]).toEqual([true, true]);
	});

	it("stays the browser's from any other route", () => {
		const selection = stateOver(TABLE);
		selection.enterCrossBlock(APPLE.anchor, APPLE.focus);
		expect(selection.ownsRange).toBe(false);
	});

	it('a focus that leaves the cell takes the anchor to its cell', () => {
		const selection = stateOver(TABLE);
		selection.ownBlockRange(APPLE.anchor, APPLE.focus, finger());
		selection.extendFocus(cell([0], 1));
		expect([selection.anchor, selection.focus]).toEqual([cell([0], 0), cell([0], 1)]);
	});

	it('G1.178: a text end inside a cell pairs only with an end in that cell', () => {
		const doc = parse(`${TABLE}\nnext\n`);
		expect(checkCellTextEndpoint(doc, APPLE.anchor, APPLE.focus)).toBeNull();
		expect(
			checkCellTextEndpoint(doc, { path: [0], offset: 0, cellCoordinate: true }, at([1], 2))
		).toBeNull();
		const unpaired = checkCellTextEndpoint(doc, APPLE.anchor, at([1], 2));
		expect(unpaired?.code).toBe('cell-text-endpoint-unpaired');
	});
});

describe('what an edit over it leaves', () => {
	it("a word that is the cell's whole text is two kept edges, never the cell held whole", () => {
		const doc = parse(TABLE);
		const berry = coverRange(doc, at([0, 0, 1], 0), at([0, 0, 1], 5));
		const coverage = rangeCoverage(doc, berry);
		expect(coverage.wholeRoots).toEqual([]);
		expect([coverage.startEdge, coverage.endEdge]).toEqual([berry.start, berry.end]);
	});

	for (const [name, word, want] of [
		['part of a cell', APPLE, '| pie | berry |'],
		['a whole cell', { anchor: at([0, 0, 1], 0), focus: at([0, 0, 1], 5) }, '| apple pie |  |']
	] as const) {
		it(`Backspace over ${name} takes the text and keeps the cell`, async () => {
			const env = rangeKeyEnv(TABLE);
			env.h.deps.selectionState.ownBlockRange(word.anchor, word.focus, finger());
			await rangeKey(env, 'Backspace');
			expect(serialize(env.h.deps.doc).split('\n')[0]).toBe(want);
			expect(blockNodeAt(env.h.deps.doc, word.anchor.path)?.kind).toBe('tableCell');
		});
	}
});
