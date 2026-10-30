/**
 * Turns a keydown into a plan for a table cell's caret-dependent moves: the next cell at a text
 * boundary, a row, or out of the table. Tab and Enter are keymap chords, planned by
 * `cellCommandPlan`. A vertical arrow ignores Alt and Mod, since the command dispatcher takes those
 * first; a sideways move takes only a caret key; a Cmd+Arrow is a caret-edge key, so it is `native`.
 */
import { cellAbove, cellBelow, nextCell, prevCell, type CellCoord } from './table-navigation';
import {
	caretEdgeKey,
	isSelectAllChord,
	motionKey,
	type ChordKeys
} from '../../../schema/keybindings';

export interface CellKeyState {
	rowIdx: number;
	colIdx: number;
	columnCount: number;
	rowCount: number;
	/** Null with no caret in the cell (reading mode has none), where every arrow is at its edge. */
	offset: number | null;
	/** The first and last offsets the caret can sit at in the cell. A mode that draws no marker
	 *  puts a leading or trailing run out of reach, so a test of raw 0 or the length never fires. */
	contentStart: number;
	contentEnd: number;
	collapsed: boolean;
	selectAllCount: number;
}

export type CellKeyPlan =
	| { kind: 'native' }
	| { kind: 'select-all-step'; step: 'native' | 'document' }
	| { kind: 'focus-cell'; rowIdx: number; colIdx: number; position: 'start' | 'end' }
	| { kind: 'insert-row-below' }
	| { kind: 'exit'; direction: 'up' | 'down' };

export function cellKeydownPlan(e: ChordKeys, s: CellKeyState): CellKeyPlan {
	const pos = { rowIdx: s.rowIdx, colIdx: s.colIdx };

	// Two stages, like every other block: the cell's own text first, then the document.
	if (isSelectAllChord(e)) {
		return {
			kind: 'select-all-step',
			step: s.selectAllCount === 0 ? 'native' : 'document'
		};
	}
	if (caretEdgeKey(e)) return { kind: 'native' };
	const atStart = s.offset === null || (s.offset <= s.contentStart && s.collapsed);
	const atEnd = s.offset === null || (s.offset >= s.contentEnd && s.collapsed);
	// Off a Mac, Alt+Arrow is the page's Back and Forward.
	const sideways = !e.shiftKey && motionKey(e) !== null;
	if (e.key === 'ArrowLeft' && sideways && atStart) {
		return horizontalMove(prevCell(pos, s.columnCount), 'end', 'up');
	}
	if (e.key === 'ArrowRight' && sideways && atEnd) {
		return horizontalMove(nextCell(pos, s.columnCount, s.rowCount), 'start', 'down');
	}
	if (e.key === 'ArrowUp' && !e.shiftKey) return verticalMove(cellAbove(pos), 'up');
	if (e.key === 'ArrowDown' && !e.shiftKey) return verticalMove(cellBelow(pos, s.rowCount), 'down');
	if (e.key === 'Backspace' && s.offset !== null && atStart) {
		return horizontalMove(prevCell(pos, s.columnCount), 'end', 'up');
	}
	if (e.key === 'Delete' && s.offset !== null && atEnd) {
		return horizontalMove(nextCell(pos, s.columnCount, s.rowCount), 'start', 'down');
	}
	return { kind: 'native' };
}

/** The keymap's cell moves; Tab and Enter past the table's last cell append a row. */
export type CellMoveCommand = 'cell.tab' | 'cell.shiftTab' | 'cell.enter';

export function cellCommandPlan(id: CellMoveCommand, s: CellKeyState): CellKeyPlan {
	const pos = { rowIdx: s.rowIdx, colIdx: s.colIdx };
	switch (id) {
		case 'cell.tab':
			return orAppendRow(nextCell(pos, s.columnCount, s.rowCount));
		case 'cell.shiftTab':
			return horizontalMove(prevCell(pos, s.columnCount), 'end', 'up');
		case 'cell.enter':
			return orAppendRow(cellBelow(pos, s.rowCount));
	}
}

function orAppendRow(move: CellCoord | null): CellKeyPlan {
	return move
		? { kind: 'focus-cell', rowIdx: move.rowIdx, colIdx: move.colIdx, position: 'start' }
		: { kind: 'insert-row-below' };
}

function horizontalMove(
	move: CellCoord | null,
	position: 'start' | 'end',
	exit: 'up' | 'down'
): CellKeyPlan {
	return move
		? { kind: 'focus-cell', rowIdx: move.rowIdx, colIdx: move.colIdx, position }
		: { kind: 'exit', direction: exit };
}

function verticalMove(move: CellCoord | null, exit: 'up' | 'down'): CellKeyPlan {
	return move
		? {
				kind: 'focus-cell',
				rowIdx: move.rowIdx,
				colIdx: move.colIdx,
				position: 'start'
			}
		: { kind: 'exit', direction: exit };
}
