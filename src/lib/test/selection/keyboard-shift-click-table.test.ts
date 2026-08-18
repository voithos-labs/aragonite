// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same two DOM seams as keyboard-shift-click.test.ts, mocked because jsdom has no layout.
// readNativeCaretInBlock echoes the path it is handed, which is what makes the deepening visible.
vi.mock('../../selection/native-bridge', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../selection/native-bridge')>()),
	offsetFromViewportPoint: vi.fn(),
	readNativeCaretInBlock: vi.fn()
}));

import { createSelectionState } from '../../selection/selection-state.svelte';
import { handleShiftClick } from '../../selection/keyboard-extend';
import { offsetFromViewportPoint, readNativeCaretInBlock } from '../../selection/native-bridge';
import { parse } from '../../core/parser';
import type { Document } from '../../core/nodes';
import { mountTableGrid } from './table-grid';

const clickOffset = vi.mocked(offsetFromViewportPoint);
const anchorCaret = vi.mocked(readNativeCaretInBlock);

const TABLE_DOC = '| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n\nSome paragraph.\n';

function stateOver(doc: Document) {
	return createSelectionState({ getDoc: () => doc });
}

/** A mounted 3-column table at `[0]`, matching the grid's selector contract. */
function mountTable(tablePath: number[], rowCount: number, colCount: number): HTMLElement[][] {
	const { host, cells } = mountTableGrid({
		path: tablePath,
		rows: rowCount,
		cols: colCount,
		editableCells: true
	});
	document.body.appendChild(host);
	return cells;
}

beforeEach(() => {
	document.body.innerHTML = '';
	clickOffset.mockReset();
	anchorCaret.mockReset();
	anchorCaret.mockImplementation((_el, path) => ({ path: path.slice(), offset: 5 }));
});

describe('handleShiftClick out of a table cell', () => {
	it('mints a cell-coordinate anchor, not the cell caret’s character offset', () => {
		const doc = parse(TABLE_DOC);
		const s = stateOver(doc);
		const cells = mountTable([0], 3, 3);
		clickOffset.mockReturnValue(4);

		// Caret 5 characters into header cell (0,0); shift+click into the paragraph.
		expect(handleShiftClick(s, document.createElement('div'), [1], 0, 0, cells[0][0], [0])).toBe(
			true
		);

		expect(s.anchor).toEqual({ path: [0], offset: 0, cellCoordinate: true });
		expect(s.focus).toEqual({ path: [1], offset: 4 });
	});

	it('anchors on the clicked cell’s own row, so the whole-row snap keeps that row', () => {
		const doc = parse(TABLE_DOC);
		const s = stateOver(doc);
		const cells = mountTable([0], 3, 3);
		clickOffset.mockReturnValue(0);

		expect(handleShiftClick(s, document.createElement('div'), [1], 0, 0, cells[2][1], [0])).toBe(
			true
		);

		// Cell (2,1) → index 7; the start side snaps down to its row's first cell.
		expect(s.anchor).toEqual({ path: [0], offset: 7, cellCoordinate: true });
		expect(s.start).toEqual({ path: [0], offset: 6, cellCoordinate: true });
	});

	it('defers to native selection when the shift+click stays inside the anchor cell', () => {
		const doc = parse(TABLE_DOC);
		const s = stateOver(doc);
		const cells = mountTable([0], 3, 3);
		clickOffset.mockReturnValue(2);

		// The cell is its own editable surface, so its getMyPath() is the deep path.
		expect(handleShiftClick(s, cells[1][2], [0, 1, 2], 0, 0, cells[1][2], [0])).toBe(false);
		expect(s.isCrossBlock).toBe(false);
	});

	it('leaves a non-table anchor element on its own block path', () => {
		const doc = parse(TABLE_DOC);
		const s = stateOver(doc);
		const paragraph = document.createElement('div');
		clickOffset.mockReturnValue(1);

		expect(
			handleShiftClick(s, document.createElement('div'), [0, 0, 0], 0, 0, paragraph, [1])
		).toBe(true);
		expect(s.anchor).toEqual({ path: [1], offset: 5 });
	});
});
