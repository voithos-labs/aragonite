/**
 * Pure keydown → plan for a table cell: everything decidable from event
 * fields, cell coordinates, and cursor state. The component translates the
 * plan into context calls (focus, structural ops, selection, exit).
 */
import { cellAbove, cellBelow, nextCell, prevCell, type CellMove } from './table-navigation';

export interface CellKeyInput {
	key: string;
	ctrlOrMeta: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

export interface CellKeyState {
	rowIdx: number;
	colIdx: number;
	columnCount: number;
	rowCount: number;
	offset: number;
	textLen: number;
	collapsed: boolean;
	selectAllCount: number;
}

export type CellShortcutAction =
	| 'insertRowBelow'
	| 'insertRowAbove'
	| 'insertColumnRight'
	| 'insertColumnLeft'
	| 'deleteRow'
	| 'deleteColumn'
	| 'moveRowUp'
	| 'moveRowDown'
	| 'moveColumnLeft'
	| 'moveColumnRight'
	| 'cycleAlignment';

export type CellKeyPlan =
	| { kind: 'native' }
	| { kind: 'select-all-step'; step: 'native' | 'table' | 'document' }
	| { kind: 'shortcut'; action: CellShortcutAction; arg: number }
	| {
			kind: 'focus-cell';
			rowIdx: number;
			colIdx: number;
			position: 'start' | 'end';
			setStickyColumn?: number;
	  }
	| { kind: 'insert-row-below' }
	| { kind: 'exit'; direction: 'up' | 'down' };

// CapsLock (or a held Shift) reports the letter uppercased, so both chords that
// key off `a` test through here rather than against a single literal.
function isLetterA(key: string): boolean {
	return key === 'a' || key === 'A';
}

const SHORTCUTS: Array<{
	match: (e: CellKeyInput) => boolean;
	action: CellShortcutAction;
	arg: (s: CellKeyState) => number;
}> = [
	{
		match: (e) => e.ctrlOrMeta && e.key === 'Enter' && !e.shiftKey && !e.altKey,
		action: 'insertRowBelow',
		arg: (s) => s.rowIdx
	},
	{
		match: (e) => e.ctrlOrMeta && e.key === 'Enter' && e.shiftKey && !e.altKey,
		action: 'insertRowAbove',
		arg: (s) => s.rowIdx
	},
	{
		match: (e) => e.altKey && e.shiftKey && !e.ctrlOrMeta && e.key === 'ArrowRight',
		action: 'insertColumnRight',
		arg: (s) => s.colIdx
	},
	{
		match: (e) => e.altKey && e.shiftKey && !e.ctrlOrMeta && e.key === 'ArrowLeft',
		action: 'insertColumnLeft',
		arg: (s) => s.colIdx
	},
	{
		match: (e) => e.ctrlOrMeta && e.shiftKey && !e.altKey && e.key === 'Backspace',
		action: 'deleteRow',
		arg: (s) => s.rowIdx
	},
	{
		match: (e) => e.altKey && e.shiftKey && !e.ctrlOrMeta && e.key === 'Backspace',
		action: 'deleteColumn',
		arg: (s) => s.colIdx
	},
	// Before the arrow-nav branches below: an Alt+Arrow reorder must win over the
	// caret move the same key triggers otherwise — for L/R that caret move is a
	// cell hop at the cell edge, which the nav branches do not gate on altKey.
	{
		match: (e) => e.altKey && !e.shiftKey && !e.ctrlOrMeta && e.key === 'ArrowUp',
		action: 'moveRowUp',
		arg: (s) => s.rowIdx
	},
	{
		match: (e) => e.altKey && !e.shiftKey && !e.ctrlOrMeta && e.key === 'ArrowDown',
		action: 'moveRowDown',
		arg: (s) => s.rowIdx
	},
	{
		match: (e) => e.altKey && !e.shiftKey && !e.ctrlOrMeta && e.key === 'ArrowLeft',
		action: 'moveColumnLeft',
		arg: (s) => s.colIdx
	},
	{
		match: (e) => e.altKey && !e.shiftKey && !e.ctrlOrMeta && e.key === 'ArrowRight',
		action: 'moveColumnRight',
		arg: (s) => s.colIdx
	},
	{
		match: (e) => e.ctrlOrMeta && e.shiftKey && !e.altKey && isLetterA(e.key),
		action: 'cycleAlignment',
		arg: (s) => s.colIdx
	}
];

export function cellKeydownPlan(e: CellKeyInput, s: CellKeyState): CellKeyPlan {
	const pos = { rowIdx: s.rowIdx, colIdx: s.colIdx };

	if (e.ctrlOrMeta && isLetterA(e.key) && !e.shiftKey && !e.altKey) {
		return {
			kind: 'select-all-step',
			step: s.selectAllCount === 0 ? 'native' : s.selectAllCount === 1 ? 'table' : 'document'
		};
	}
	for (const sc of SHORTCUTS) {
		if (sc.match(e)) return { kind: 'shortcut', action: sc.action, arg: sc.arg(s) };
	}
	if (e.key === 'ArrowLeft' && !e.shiftKey && s.offset === 0 && s.collapsed) {
		return horizontalMove(prevCell(pos, s.columnCount), 'end', 'up');
	}
	if (e.key === 'ArrowRight' && !e.shiftKey && s.offset === s.textLen && s.collapsed) {
		return horizontalMove(nextCell(pos, s.columnCount, s.rowCount), 'start', 'down');
	}
	if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey) return verticalMove(cellAbove(pos), 'up');
	if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey)
		return verticalMove(cellBelow(pos, s.rowCount), 'down');
	if (e.key === 'Tab' && !e.shiftKey) {
		const move = nextCell(pos, s.columnCount, s.rowCount);
		return move.kind === 'cell'
			? { kind: 'focus-cell', rowIdx: move.rowIdx, colIdx: move.colIdx, position: 'start' }
			: { kind: 'insert-row-below' };
	}
	if (e.key === 'Tab' && e.shiftKey)
		return horizontalMove(prevCell(pos, s.columnCount), 'end', 'up');
	if (e.key === 'Enter' && !e.shiftKey) {
		const move = cellBelow(pos, s.rowCount);
		return move.kind === 'cell'
			? { kind: 'focus-cell', rowIdx: move.rowIdx, colIdx: move.colIdx, position: 'start' }
			: { kind: 'insert-row-below' };
	}
	if (e.key === 'Backspace' && s.offset === 0 && s.collapsed) {
		return horizontalMove(prevCell(pos, s.columnCount), 'end', 'up');
	}
	if (e.key === 'Delete' && s.offset === s.textLen && s.collapsed) {
		return horizontalMove(nextCell(pos, s.columnCount, s.rowCount), 'start', 'down');
	}
	return { kind: 'native' };
}

function horizontalMove(
	move: CellMove,
	position: 'start' | 'end',
	exit: 'up' | 'down'
): CellKeyPlan {
	return move.kind === 'cell'
		? { kind: 'focus-cell', rowIdx: move.rowIdx, colIdx: move.colIdx, position }
		: { kind: 'exit', direction: exit };
}

function verticalMove(move: CellMove, exit: 'up' | 'down'): CellKeyPlan {
	return move.kind === 'cell'
		? {
				kind: 'focus-cell',
				rowIdx: move.rowIdx,
				colIdx: move.colIdx,
				position: 'start',
				setStickyColumn: move.colIdx
			}
		: { kind: 'exit', direction: exit };
}
