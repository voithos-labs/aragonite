import { describe, it, expect } from 'vitest';
import {
	cellCommandPlan,
	cellKeydownPlan,
	type CellKeyPlan,
	type CellMoveCommand,
	type CellKeyState
} from '../../../components/blocks/table/cell-keydown-plan';
import type { ChordKeys } from '../../../schema/keybindings';

const key = (k: string, mods: Partial<ChordKeys> = {}): ChordKeys => ({
	key: k,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	altKey: false,
	...mods
});

// Middle cell of a 3×3 table, collapsed cursor mid-text.
const state = (over: Partial<CellKeyState> = {}): CellKeyState => ({
	rowIdx: 1,
	colIdx: 1,
	columnCount: 3,
	rowCount: 3,
	offset: 1,
	contentStart: 0,
	contentEnd: 3,
	collapsed: true,
	selectAllCount: 0,
	...over
});

const cell = (
	rowIdx: number,
	colIdx: number,
	position: 'start' | 'end'
): Extract<CellKeyPlan, { kind: 'focus-cell' }> => ({
	kind: 'focus-cell',
	rowIdx,
	colIdx,
	position
});

// The structural chords are keymap bindings, so an arrow that reaches the plan was taken by
// nothing and must navigate; `native` hands it to the prose path, which moves by sibling index.
describe('cellKeydownPlan: an unclaimed caret-key chord still navigates', () => {
	const cases: Array<[string, ChordKeys, Partial<CellKeyState>, CellKeyPlan]> = [
		['Mod+ArrowDown', key('ArrowDown', { ctrlKey: true }), {}, cell(2, 1, 'start')],
		[
			'Mod+ArrowRight at the right edge',
			key('ArrowRight', { ctrlKey: true }),
			{ offset: 3 },
			cell(1, 2, 'start')
		]
	];
	for (const [name, input, over, plan] of cases) {
		it(`${name} → ${plan.kind}`, () => {
			expect(cellKeydownPlan(input, state(over))).toEqual(plan);
		});
	}
});

// Miss-analysis: the rows above read any modified arrow as navigation, and none asked what a
// host's Alt+← (Back, off a Mac) does with the caret at a cell's edge or in reading mode.
describe('cellKeydownPlan: a sideways step takes only a caret key', () => {
	// Alt+ArrowUp and Down are the row move's, so a disabled one leaves the caret where it is.
	it('leaves Alt+ArrowUp to the row move', () => {
		expect(cellKeydownPlan(key('ArrowUp', { altKey: true }), state({}))).toEqual({
			kind: 'native'
		});
	});

	it('leaves Alt+ArrowLeft at the left edge to the page', () => {
		expect(cellKeydownPlan(key('ArrowLeft', { altKey: true }), state({ offset: 0 }))).toEqual({
			kind: 'native'
		});
	});
});

describe('cellKeydownPlan: ctrl+a select-all stepping', () => {
	const steps: Array<[number, 'native' | 'document']> = [
		[0, 'native'],
		[1, 'document'],
		[2, 'document'],
		[5, 'document']
	];
	for (const [selectAllCount, step] of steps) {
		it(`count ${selectAllCount} → ${step}`, () => {
			expect(cellKeydownPlan(key('a', { ctrlKey: true }), state({ selectAllCount }))).toEqual({
				kind: 'select-all-step',
				step
			});
		});
	}

	// CapsLock reports the letter uppercased, so testing only `'a'` would miss the staged
	// select-all entirely: the plan falls through to 'native' and the counter never moves.
	it('starts the run with CapsLock on', () => {
		expect(cellKeydownPlan(key('A', { ctrlKey: true }), state({ selectAllCount: 1 }))).toEqual({
			kind: 'select-all-step',
			step: 'document'
		});
	});
});

describe('cellKeydownPlan: arrow boundary moves', () => {
	const cases: Array<[string, ChordKeys, Partial<CellKeyState>, CellKeyPlan]> = [
		['ArrowLeft at offset 0 mid-row', key('ArrowLeft'), { offset: 0 }, cell(1, 0, 'end')],
		[
			'ArrowLeft at offset 0 first cell',
			key('ArrowLeft'),
			{ rowIdx: 0, colIdx: 0, offset: 0 },
			{ kind: 'exit', direction: 'up' }
		],
		['ArrowLeft mid-text', key('ArrowLeft'), {}, { kind: 'native' }],
		['ArrowRight at end mid-row', key('ArrowRight'), { offset: 3 }, cell(1, 2, 'start')],
		[
			'ArrowRight at end last cell',
			key('ArrowRight'),
			{ rowIdx: 2, colIdx: 2, offset: 3 },
			{ kind: 'exit', direction: 'down' }
		],
		[
			'ArrowLeft at offset 0 with selection',
			key('ArrowLeft'),
			{ offset: 0, collapsed: false },
			{ kind: 'native' }
		],
		[
			'ArrowRight at end with selection',
			key('ArrowRight'),
			{ offset: 3, collapsed: false },
			{ kind: 'native' }
		],
		// A cell that opens or closes with a run the mode draws nothing for: the move fires at
		// the offsets the caret can reach, not at raw 0 and the raw length.
		[
			'ArrowLeft at a reachable start short of 0',
			key('ArrowLeft'),
			{ offset: 1, contentStart: 1 },
			cell(1, 0, 'end')
		],
		[
			'ArrowRight at a reachable end short of the raw length',
			key('ArrowRight'),
			{ offset: 5, contentEnd: 5 },
			cell(1, 2, 'start')
		],
		['ArrowUp mid-table', key('ArrowUp'), {}, cell(0, 1, 'start')],
		['ArrowUp top row', key('ArrowUp'), { rowIdx: 0 }, { kind: 'exit', direction: 'up' }],
		['ArrowDown mid-table', key('ArrowDown'), {}, cell(2, 1, 'start')],
		['ArrowDown bottom row', key('ArrowDown'), { rowIdx: 2 }, { kind: 'exit', direction: 'down' }]
	];
	for (const [name, input, over, plan] of cases) {
		it(`${name} → ${plan.kind}`, () => {
			expect(cellKeydownPlan(input, state(over))).toEqual(plan);
		});
	}
});

// With no caret (reading mode), every arrow is at the cell's edge; Backspace and Delete move none.
describe('cellKeydownPlan: a cell with no caret', () => {
	const cases: Array<[string, ChordKeys, CellKeyPlan]> = [
		['ArrowRight', key('ArrowRight'), cell(1, 2, 'start')],
		['ArrowLeft', key('ArrowLeft'), cell(1, 0, 'end')],
		['ArrowDown', key('ArrowDown'), cell(2, 1, 'start')],
		['Backspace', key('Backspace'), { kind: 'native' }],
		['Delete', key('Delete'), { kind: 'native' }]
	];
	for (const [name, input, plan] of cases) {
		it(`${name} → ${plan.kind}`, () => {
			expect(cellKeydownPlan(input, state({ offset: null }))).toEqual(plan);
		});
	}
});

describe('cellCommandPlan: the keymap moves', () => {
	const cases: Array<[string, CellMoveCommand, Partial<CellKeyState>, CellKeyPlan]> = [
		['Tab mid-table', 'cell.tab', {}, cell(1, 2, 'start')],
		['Tab last cell', 'cell.tab', { rowIdx: 2, colIdx: 2 }, { kind: 'insert-row-below' }],
		['Shift+Tab mid-table', 'cell.shiftTab', {}, cell(1, 0, 'end')],
		[
			'Shift+Tab first cell',
			'cell.shiftTab',
			{ rowIdx: 0, colIdx: 0 },
			{ kind: 'exit', direction: 'up' }
		],
		['Enter mid-table (no sticky column)', 'cell.enter', {}, cell(2, 1, 'start')],
		['Enter last row', 'cell.enter', { rowIdx: 2 }, { kind: 'insert-row-below' }]
	];
	for (const [name, id, over, plan] of cases) {
		it(`${name} → ${plan.kind}`, () => {
			expect(cellCommandPlan(id, state(over))).toEqual(plan);
		});
	}

	// A key the keymap declined (reading mode, a disabled binding) is the browser's.
	for (const [name, input] of [
		['Tab', key('Tab')],
		['Shift+Tab', key('Tab', { shiftKey: true })],
		['Enter', key('Enter')]
	] as const) {
		it(`the keydown plan leaves ${name} alone`, () => {
			expect(cellKeydownPlan(input, state({ rowIdx: 2, colIdx: 2 }))).toEqual({ kind: 'native' });
		});
	}
});

describe('cellKeydownPlan: backspace, delete, and native fallthrough', () => {
	const cases: Array<[string, ChordKeys, Partial<CellKeyState>, CellKeyPlan]> = [
		['Backspace at offset 0', key('Backspace'), { offset: 0 }, cell(1, 0, 'end')],
		[
			'Backspace at offset 0 with selection',
			key('Backspace'),
			{ offset: 0, collapsed: false },
			{ kind: 'native' }
		],
		['Backspace mid-text', key('Backspace'), {}, { kind: 'native' }],
		[
			'Backspace at a reachable start short of 0',
			key('Backspace'),
			{ offset: 1, contentStart: 1 },
			cell(1, 0, 'end')
		],
		[
			'Delete at a reachable end short of the raw length',
			key('Delete'),
			{ offset: 5, contentEnd: 5 },
			cell(1, 2, 'start')
		],
		['Delete at end', key('Delete'), { offset: 3 }, cell(1, 2, 'start')],
		[
			'Delete at end with selection',
			key('Delete'),
			{ offset: 3, collapsed: false },
			{ kind: 'native' }
		],
		[
			'Shift+ArrowLeft at offset 0',
			key('ArrowLeft', { shiftKey: true }),
			{ offset: 0 },
			{ kind: 'native' }
		],
		['Shift+ArrowDown', key('ArrowDown', { shiftKey: true }), {}, { kind: 'native' }],
		['plain typing key', key('x'), {}, { kind: 'native' }]
	];
	for (const [name, input, over, plan] of cases) {
		it(`${name} → ${plan.kind}`, () => {
			expect(cellKeydownPlan(input, state(over))).toEqual(plan);
		});
	}
});
