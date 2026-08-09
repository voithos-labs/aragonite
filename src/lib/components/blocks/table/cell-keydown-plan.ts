/**
 * Pure keydown → plan for a table cell's caret-dependent navigation: cell hop at a text
 * boundary, row hop, table exit, the row-appending end of Tab/Enter. Chords are keymap
 * bindings the command dispatcher claims first, so the branches below ignore Alt and
 * Mod: an unclaimed modified arrow must still navigate, and answering `native` hands it
 * to the prose prelude, which moves among siblings by index — the wrong axis for a cell.
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
	/** The cell's landable extremes. A mode that paints no marker puts a leading or trailing
	 *  run out of the caret's reach, and a hop testing raw 0 / raw length never fires. */
	contentStart: number;
	contentEnd: number;
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
	if (e.key === 'ArrowLeft' && !e.shiftKey && s.offset <= s.contentStart && s.collapsed) {
		return horizontalMove(prevCell(pos, s.columnCount), 'end', 'up');
	}
	if (e.key === 'ArrowRight' && !e.shiftKey && s.offset >= s.contentEnd && s.collapsed) {
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
	if (e.key === 'Backspace' && s.offset <= s.contentStart && s.collapsed) {
		return horizontalMove(prevCell(pos, s.columnCount), 'end', 'up');
	}
	if (e.key === 'Delete' && s.offset >= s.contentEnd && s.collapsed) {
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
