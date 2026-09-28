// @vitest-environment jsdom
// Miss-analysis: every rectangle test built a flagged anchor and a bare focus, never bare points.
import { describe, it, expect } from 'vitest';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { resolveSelectionPoint, restoreSelection } from '../../selection/selection-restore';
import { createCaretMemory } from '../../cursor/caret-memory';
import { parse } from '../../core/parser';
import { collectCrossBlockText } from '../../selection/clipboard-text';
import { coverRange } from '../../selection/range-coverage';

// A 2-column table with a header and two body rows: cell indices 0..5.
const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\npara\n';
const cell = (offset: number) => ({ path: [0], offset, cellCoordinate: true });

function tableState() {
	const doc = parse(TABLE);
	return { doc, state: createSelectionState({ getDoc: () => doc }) };
}

describe('an endpoint on a table path is stored as a cell index', () => {
	it('enterCrossBlock flags a bare same-path pair and keeps it as a rectangle', () => {
		const { state } = tableState();
		state.enterCrossBlock({ path: [0], offset: 0 }, { path: [0], offset: 5 });
		expect(state.anchor).toEqual(cell(0));
		expect(state.focus).toEqual(cell(5));
		expect(state.isCustomRendered).toBe(true);
	});

	it('enterCrossBlock flags the bare focus of a pair whose anchor is already flagged', () => {
		const { state } = tableState();
		state.enterCrossBlock(cell(0), { path: [0], offset: 3 });
		expect(state.focus).toEqual(cell(3));
	});

	it('extendFocus flags a bare focus inside the same table', () => {
		const { state } = tableState();
		state.enterCrossBlock(cell(0), cell(1));
		state.extendFocus({ path: [0], offset: 4 });
		expect(state.focus).toEqual(cell(4));
	});

	// No gesture takes a table whole (a margin drag starts a cell rectangle instead), but the
	// state API accepts the shape, so copy and delete must read it as cells.
	it('enterCrossBlock takes a table whole as its first and last cell', () => {
		const { state } = tableState();
		state.enterCrossBlock({ path: [0], wholeBlock: true }, { path: [0], wholeBlock: true });
		expect([state.anchor, state.focus, state.wholeUnitPath]).toEqual([cell(0), cell(5), [0]]);
		const doc = parse(TABLE);
		expect(collectCrossBlockText(doc, coverRange(doc, state.anchor!, state.focus!))).toBe(
			'| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n'
		);
	});

	it('extendFocus out of a whole-table unit turns its anchor into the facing cell', () => {
		const { state } = tableState();
		state.enterCrossBlock({ path: [0], wholeBlock: true }, { path: [0], wholeBlock: true });
		state.extendFocus({ path: [1], offset: 2 });
		expect(state.anchor).toEqual(cell(0));
	});

	// Miss-analysis: every bare-offset row used an index inside the grid.
	it('clamps a bare offset past the last cell to the last cell', () => {
		const doc = parse('para\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');
		const state = createSelectionState({ getDoc: () => doc });
		state.enterCrossBlock({ path: [0], offset: 2 }, { path: [1], offset: 40 });
		expect(state.focus).toEqual({ path: [1], offset: 5, cellCoordinate: true });
	});

	it('extendFocus flags a bare focus on a table reached from prose', () => {
		const { state } = tableState();
		state.enterCrossBlock({ path: [1], offset: 2 }, cell(5));
		state.extendFocus({ path: [0], offset: 2 });
		expect(state.focus).toEqual(cell(2));
	});
});

// A host's `setSelection` can hand in bare points on a table path.
describe('a restored endpoint on a table path comes back flagged', () => {
	it('resolveSelectionPoint flags a bare table point', () => {
		expect(resolveSelectionPoint(parse(TABLE), { path: [0], offset: 4 })).toEqual(cell(4));
	});

	it('restoreSelection stores a bare stored rectangle as flagged cells', async () => {
		const { doc, state } = tableState();
		await restoreSelection(
			{ anchor: { path: [0], offset: 1 }, focus: { path: [0], offset: 4 } },
			{
				getDoc: () => doc,
				selectionState: state,
				caretMemory: createCaretMemory(),
				getBlockElByPath: () => document.createElement('div'),
				revealTarget: async () => true
			}
		);
		expect(state.anchor).toEqual(cell(1));
		expect(state.focus).toEqual(cell(4));
	});
});
