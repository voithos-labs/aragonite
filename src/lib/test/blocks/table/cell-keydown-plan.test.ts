import { describe, it, expect } from 'vitest';
import {
	cellKeydownPlan,
	type CellKeyInput,
	type CellKeyPlan,
	type CellKeyState,
	type CellShortcutAction
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
	textLen: 3,
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

describe('cellKeydownPlan: structural shortcuts', () => {
	const cases: Array<[CellKeyInput, CellShortcutAction, number]> = [
		[key('Enter', { ctrlOrMeta: true }), 'insertRowBelow', 1],
		[key('Enter', { ctrlOrMeta: true, shiftKey: true }), 'insertRowAbove', 1],
		[key('ArrowRight', { altKey: true, shiftKey: true }), 'insertColumnRight', 1],
		[key('ArrowLeft', { altKey: true, shiftKey: true }), 'insertColumnLeft', 1],
		[key('Backspace', { ctrlOrMeta: true, shiftKey: true }), 'deleteRow', 1],
		[key('Backspace', { altKey: true, shiftKey: true }), 'deleteColumn', 1],
		[key('A', { ctrlOrMeta: true, shiftKey: true }), 'cycleAlignment', 1]
	];
	for (const [input, action, arg] of cases) {
		it(`${[input.ctrlOrMeta && 'ctrl', input.altKey && 'alt', input.shiftKey && 'shift', input.key]
			.filter(Boolean)
			.join('+')} → ${action}`, () => {
			expect(cellKeydownPlan(input, state())).toEqual({ kind: 'shortcut', action, arg });
		});
	}
});

// Alt+Arrow column reorder is matched before the boundary arrow-nav branches,
// which (unlike ArrowUp/Down) do not gate on altKey — without precedence the same
// key would hop a cell at the edge instead of moving the column.
describe('cellKeydownPlan: alt+arrow column reorder', () => {
	const cases: Array<[string, CellKeyInput, Partial<CellKeyState>, CellShortcutAction, number]> = [
		['Alt+ArrowRight mid-text', key('ArrowRight', { altKey: true }), {}, 'moveColumnRight', 1],
		['Alt+ArrowLeft mid-text', key('ArrowLeft', { altKey: true }), {}, 'moveColumnLeft', 1],
		[
			'Alt+ArrowRight at right edge beats the cell hop',
			key('ArrowRight', { altKey: true }),
			{ offset: 3 },
			'moveColumnRight',
			1
		],
		[
			'Alt+ArrowLeft at left edge beats the cell hop',
			key('ArrowLeft', { altKey: true }),
			{ offset: 0 },
			'moveColumnLeft',
			1
		]
	];
	for (const [name, input, over, action, arg] of cases) {
		it(name, () => {
			expect(cellKeydownPlan(input, state(over))).toEqual({ kind: 'shortcut', action, arg });
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
