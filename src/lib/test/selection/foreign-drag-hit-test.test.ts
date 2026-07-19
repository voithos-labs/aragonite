// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerBuiltInBlocks } from '../../components/built-in-blocks';
import { tableDragHitTest } from '../../components/blocks/table/table-drag-hit-test';

registerBuiltInBlocks();
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';

describe('table foreignDragHitTest', () => {
	let wrapper: HTMLElement;
	let cells: HTMLElement[][];
	const origFromPoint = document.elementFromPoint;

	beforeEach(() => {
		// [data-block-path] wrapper → [role="table"] → 2 rows × 3 cells.
		wrapper = document.createElement('div');
		wrapper.setAttribute('data-block-path', '[0]');
		wrapper.setAttribute('data-block-kind', 'table');
		const table = document.createElement('div');
		table.setAttribute('role', 'table');
		wrapper.appendChild(table);
		cells = [];
		for (let r = 0; r < 2; r++) {
			const row = document.createElement('div');
			row.setAttribute('data-table-row-idx', String(r));
			table.appendChild(row);
			const rowCells: HTMLElement[] = [];
			for (let c = 0; c < 3; c++) {
				const cell = document.createElement('div');
				cell.setAttribute('role', 'cell');
				row.appendChild(cell);
				rowCells.push(cell);
			}
			cells.push(rowCells);
		}
		document.body.appendChild(wrapper);
	});

	afterEach(() => {
		document.elementFromPoint = origFromPoint;
		wrapper.remove();
	});

	function pointAt(cell: HTMLElement) {
		document.elementFromPoint = (() => cell) as typeof document.elementFromPoint;
	}

	it('encodes a point as row-major cellIdx (row * columnCount + col)', () => {
		pointAt(cells[1][2]); // row 1, col 2, 3 columns → 1*3 + 2 = 5
		expect(tableDragHitTest(wrapper, 0, 0)).toBe(5);
	});

	it('returns the first cell as cellIdx 0', () => {
		pointAt(cells[0][0]);
		expect(tableDragHitTest(wrapper, 0, 0)).toBe(0);
	});

	it('returns null when the point is not over a cell of this table', () => {
		document.elementFromPoint = (() => document.body) as typeof document.elementFromPoint;
		expect(tableDragHitTest(wrapper, 0, 0)).toBeNull();
	});

	it('is registered on the table descriptor for generic dispatch', () => {
		const hook = tryGetBlockKindDescriptor('table')?.foreignDragHitTest;
		expect(typeof hook).toBe('function');
		pointAt(cells[0][1]); // 0*3 + 1 = 1
		expect(hook!(wrapper, 0, 0)).toBe(1);
	});

	it('is not registered on non-coordinate kinds (paragraph)', () => {
		expect(tryGetBlockKindDescriptor('paragraph')?.foreignDragHitTest).toBeUndefined();
	});

	it('still encodes the hit when row windowing has unmounted row 0', () => {
		// Row-windowing scrolls row 0 off-screen and unmounts it; the column count
		// must come from any mounted row, not the hard-coded row 0 (VR-K1).
		cells[0][0].closest('[data-table-row-idx]')!.remove();
		pointAt(cells[1][2]); // row 1, col 2 → 1*3 + 2 = 5
		expect(tableDragHitTest(wrapper, 0, 0)).toBe(5);
	});
});
