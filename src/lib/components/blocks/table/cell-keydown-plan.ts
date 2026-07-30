/**
 * Pure keydown → plan for a table cell's NAVIGATION: the moves that depend on where
 * the caret sits within the cell, which is exactly what a chord cannot express — a
 * cell hop at the text boundary, a row hop, an exit out of the table, and the
 * row-appending end of Tab/Enter. The component translates the plan into context
 * calls (focus, selection, exit).
 *
 * The structural chords (insert/delete/move a row or column, cycle alignment) used to
 * live here too, as an ordered `SHORTCUTS` table whose precedence over the boundary
 * branches below was the thing keeping `Alt+ArrowLeft` from being read as a cell hop.
 * They are `tableCell` keymap bindings now, and the precedence is the CALL ORDER in
 * the cell: the command dispatcher gets first refusal on every chord, so a chord that
 * reaches this plan is one no binding claimed.
 *
 * Which is why the branches below still ignore Alt and Mod. An unclaimed modified
 * arrow — a disabled binding, or reading mode, where the whole vocabulary dead-keys —
 * is just an arrow, and must navigate: answering `native` for it would hand the key to
 * the shared prose prelude, whose boundary branches move focus among a block's
 * siblings by index, which for a cell means the wrong axis entirely.
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

export type CellKeyPlan =
	| { kind: 'native' }
	| { kind: 'select-all-step'; step: 'native' | 'table' | 'document' }
	| {
			kind: 'focus-cell';
			rowIdx: number;
			colIdx: number;
			position: 'start' | 'end';
			setStickyColumn?: number;
	  }
	| { kind: 'insert-row-below' }
	| { kind: 'exit'; direction: 'up' | 'down' };

// CapsLock reports the letter uppercased, so the select-all chord tests for both
// spellings rather than against a single literal.
function isLetterA(key: string): boolean {
	return key === 'a' || key === 'A';
}

export function cellKeydownPlan(e: CellKeyInput, s: CellKeyState): CellKeyPlan {
	const pos = { rowIdx: s.rowIdx, colIdx: s.colIdx };

	if (e.ctrlOrMeta && isLetterA(e.key) && !e.shiftKey && !e.altKey) {
		return {
			kind: 'select-all-step',
			step: s.selectAllCount === 0 ? 'native' : s.selectAllCount === 1 ? 'table' : 'document'
		};
	}
	if (e.key === 'ArrowLeft' && !e.shiftKey && s.offset === 0 && s.collapsed) {
		return horizontalMove(prevCell(pos, s.columnCount), 'end', 'up');
	}
	if (e.key === 'ArrowRight' && !e.shiftKey && s.offset === s.textLen && s.collapsed) {
		return horizontalMove(nextCell(pos, s.columnCount, s.rowCount), 'start', 'down');
	}
	if (e.key === 'ArrowUp' && !e.shiftKey) return verticalMove(cellAbove(pos), 'up');
	if (e.key === 'ArrowDown' && !e.shiftKey) return verticalMove(cellBelow(pos, s.rowCount), 'down');
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
