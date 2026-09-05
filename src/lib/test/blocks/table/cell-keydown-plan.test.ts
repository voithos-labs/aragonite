import { describe, it, expect } from 'vitest';
import {
	cellKeydownPlan,
	type CellKeyInput,
	type CellKeyPlan,
	type CellKeyState
} from '../../../components/blocks/table/cell-keydown-plan';

const key = (k: string, mods: Partial<CellKeyInput> = {}): CellKeyInput => ({
	key: k,
	ctrlOrMeta: false,
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

// The structural chords are keymap bindings now (cell-table-chords.test.ts); an arrow reaching
// the plan is unclaimed and must navigate — `native` hands it to the prose sibling-index walk.
describe('cellKeydownPlan: an unclaimed modified arrow still navigates', () => {
	const cases: Array<[string, CellKeyInput, Partial<CellKeyState>, CellKeyPlan]> = [
		[
			'Alt+ArrowUp',
			key('ArrowUp', { altKey: true }),
			{},
			{ ...cell(0, 1, 'start'), setStickyColumn: 1 }
		],
		[
			'Mod+ArrowDown',
			key('ArrowDown', { ctrlOrMeta: true }),
			{},
			{ ...cell(2, 1, 'start'), setStickyColumn: 1 }
		],
		[
			'Alt+ArrowLeft at the left edge',
			key('ArrowLeft', { altKey: true }),
			{ offset: 0 },
			cell(1, 0, 'end')
		],
		[
			'Mod+ArrowRight at the right edge',
			key('ArrowRight', { ctrlOrMeta: true }),
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

describe('cellKeydownPlan: ctrl+a select-all stepping', () => {
	const steps: Array<[number, 'native' | 'table' | 'document']> = [
		[0, 'native'],
		[1, 'table'],
		[2, 'document'],
		[5, 'document']
	];
	for (const [selectAllCount, step] of steps) {
		it(`count ${selectAllCount} → ${step}`, () => {
			expect(cellKeydownPlan(key('a', { ctrlOrMeta: true }), state({ selectAllCount }))).toEqual({
				kind: 'select-all-step',
				step
			});
		});
	}

	// CapsLock reports the letter uppercased; testing only `'a'` dropped the whole
	// stage machine (the plan fell through to 'native' and the counter never moved).
	it('starts the run with CapsLock on', () => {
		expect(cellKeydownPlan(key('A', { ctrlOrMeta: true }), state({ selectAllCount: 1 }))).toEqual({
			kind: 'select-all-step',
			step: 'table'
		});
	});
});

describe('cellKeydownPlan: arrow boundary moves', () => {
	const cases: Array<[string, CellKeyInput, Partial<CellKeyState>, CellKeyPlan]> = [
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
		// A cell opening or closing with a run the mode paints nothing for: the hop fires at the
		// offsets the caret can reach, not at raw 0 / raw length.
		[
			'ArrowLeft at a landable start short of 0',
			key('ArrowLeft'),
			{ offset: 1, contentStart: 1 },
			cell(1, 0, 'end')
		],
		[
			'ArrowRight at a landable end short of the raw length',
			key('ArrowRight'),
			{ offset: 5, contentEnd: 5 },
			cell(1, 2, 'start')
		],
		['ArrowUp mid-table', key('ArrowUp'), {}, { ...cell(0, 1, 'start'), setStickyColumn: 1 }],
		['ArrowUp top row', key('ArrowUp'), { rowIdx: 0 }, { kind: 'exit', direction: 'up' }],
		['ArrowDown mid-table', key('ArrowDown'), {}, { ...cell(2, 1, 'start'), setStickyColumn: 1 }],
		['ArrowDown bottom row', key('ArrowDown'), { rowIdx: 2 }, { kind: 'exit', direction: 'down' }]
	];
	for (const [name, input, over, plan] of cases) {
		it(`${name} → ${plan.kind}`, () => {
			expect(cellKeydownPlan(input, state(over))).toEqual(plan);
		});
	}
});

describe('cellKeydownPlan: tab and enter', () => {
	const cases: Array<[string, CellKeyInput, Partial<CellKeyState>, CellKeyPlan]> = [
		['Tab mid-table', key('Tab'), {}, cell(1, 2, 'start')],
		['Tab last cell', key('Tab'), { rowIdx: 2, colIdx: 2 }, { kind: 'insert-row-below' }],
		['Shift+Tab mid-table', key('Tab', { shiftKey: true }), {}, cell(1, 0, 'end')],
		[
			'Shift+Tab first cell',
			key('Tab', { shiftKey: true }),
			{ rowIdx: 0, colIdx: 0 },
			{ kind: 'exit', direction: 'up' }
		],
		['Enter mid-table (no sticky column)', key('Enter'), {}, cell(2, 1, 'start')],
		['Enter last row', key('Enter'), { rowIdx: 2 }, { kind: 'insert-row-below' }]
	];
	for (const [name, input, over, plan] of cases) {
		it(`${name} → ${plan.kind}`, () => {
			expect(cellKeydownPlan(input, state(over))).toEqual(plan);
		});
	}
});

describe('cellKeydownPlan: backspace, delete, and native fallthrough', () => {
	const cases: Array<[string, CellKeyInput, Partial<CellKeyState>, CellKeyPlan]> = [
		['Backspace at offset 0', key('Backspace'), { offset: 0 }, cell(1, 0, 'end')],
		[
			'Backspace at offset 0 with selection',
			key('Backspace'),
			{ offset: 0, collapsed: false },
			{ kind: 'native' }
		],
		['Backspace mid-text', key('Backspace'), {}, { kind: 'native' }],
		[
			'Backspace at a landable start short of 0',
			key('Backspace'),
			{ offset: 1, contentStart: 1 },
			cell(1, 0, 'end')
		],
		[
			'Delete at a landable end short of the raw length',
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
