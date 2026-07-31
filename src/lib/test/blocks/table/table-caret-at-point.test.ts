// @vitest-environment jsdom
//
// The caret landing a point names inside a table. The gesture that asks (a
// dead-space click) has already clamped the point into the table's box, so the
// answers that matter are the ones the drag hit test refuses to give: a point in
// the row-grip gutter, in the padding between cells, and past a row's own edges.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CURSOR_END } from '../../../block-component';
import { registerBuiltInBlocks } from '../../../components/built-in-blocks';
import { tableCaretAtPoint } from '../../../components/blocks/table/table-caret-at-point';

registerBuiltInBlocks();
import { tryGetBlockKindDescriptor } from '../../../schema/block-kind-descriptor';

// A 2-row × 3-column grid: cells are 100 wide, rows 20 tall, the grid starting at
// (100, 50). The 20px band left of x=100 is the row-grip gutter.
const CELL_WIDTH = 100;
const ROW_HEIGHT = 20;
const GRID_LEFT = 100;
const GRID_TOP = 50;

describe('tableCaretAtPoint', () => {
	let wrapper: HTMLElement;

	beforeEach(() => {
		wrapper = document.createElement('div');
		wrapper.setAttribute('data-block-path', '[0]');
		wrapper.setAttribute('data-block-kind', 'table');
		const table = document.createElement('div');
		table.setAttribute('role', 'table');
		wrapper.appendChild(table);
		for (let r = 0; r < 2; r++) {
			const row = document.createElement('div');
			row.setAttribute('data-table-row-idx', String(r));
			table.appendChild(row);
			for (let c = 0; c < 3; c++) {
				const cell = document.createElement('div');
				cell.setAttribute('role', 'cell');
				stubRect(cell, {
					left: GRID_LEFT + c * CELL_WIDTH,
					top: GRID_TOP + r * ROW_HEIGHT
				});
				row.appendChild(cell);
			}
		}
		document.body.appendChild(wrapper);
	});

	afterEach(() => wrapper.remove());

	function stubRect(cell: HTMLElement, at: { left: number; top: number }): void {
		cell.getBoundingClientRect = () =>
			({
				left: at.left,
				right: at.left + CELL_WIDTH,
				top: at.top,
				bottom: at.top + ROW_HEIGHT
			}) as DOMRect;
	}

	const at = (x: number, y: number) => tableCaretAtPoint(wrapper, x, y);

	it('lands at the end of the cell the point is inside', () => {
		expect(at(GRID_LEFT + 150, GRID_TOP + 10)).toEqual({ path: [0, 1], offset: CURSOR_END });
	});

	it('maps x to the nearest column for a point in the row-grip gutter', () => {
		// Left of every cell in row 1 → column 0 of that row, not a decline.
		expect(at(GRID_LEFT - 15, GRID_TOP + ROW_HEIGHT + 10)).toEqual({
			path: [1, 0],
			offset: CURSOR_END
		});
	});

	it('maps a point past the grid’s right edge to the last column', () => {
		expect(at(GRID_LEFT + 3 * CELL_WIDTH + 40, GRID_TOP + 5)).toEqual({
			path: [0, 2],
			offset: CURSOR_END
		});
	});

	it('maps a point below the last row to that row, x choosing the column', () => {
		// The below-the-document gesture clamps x to the box's trailing edge, so this
		// is the shape that must land in the LAST row's last cell.
		expect(at(GRID_LEFT + 3 * CELL_WIDTH - 1, GRID_TOP + 2 * ROW_HEIGHT + 60)).toEqual({
			path: [1, 2],
			offset: CURSOR_END
		});
		// The same y under column 0 stays in column 0 — the row is nearest, not the corner.
		expect(at(GRID_LEFT + 10, GRID_TOP + 2 * ROW_HEIGHT + 60)).toEqual({
			path: [1, 0],
			offset: CURSOR_END
		});
	});

	it('maps a point above the first row to it', () => {
		expect(at(GRID_LEFT + 250, GRID_TOP - 40)).toEqual({ path: [0, 2], offset: CURSOR_END });
	});

	it('answers from the mounted rows when row windowing has unmounted row 0', () => {
		// Row 0's absolute index rides `data-table-row-idx`, so the surviving row must
		// answer as row 1 — not as the first mounted one.
		wrapper.querySelector('[data-table-row-idx="0"]')!.remove();
		expect(at(GRID_LEFT + 50, GRID_TOP - 40)).toEqual({ path: [1, 0], offset: CURSOR_END });
	});

	it('declines when the wrapper holds no table grid', () => {
		const bare = document.createElement('div');
		expect(tableCaretAtPoint(bare, 0, 0)).toBeNull();
	});

	it('declines an empty grid rather than naming a cell that is not there', () => {
		wrapper.querySelector('[role="table"]')!.innerHTML = '';
		expect(at(GRID_LEFT, GRID_TOP)).toBeNull();
	});

	it('is registered on the table descriptor for generic dispatch', () => {
		const hook = tryGetBlockKindDescriptor('table')?.caretTargetAtPoint;
		expect(typeof hook).toBe('function');
		expect(hook!(wrapper, GRID_LEFT + 150, GRID_TOP + 10)).toEqual({
			path: [0, 1],
			offset: CURSOR_END
		});
	});

	it('is not registered on a kind that addresses characters (paragraph)', () => {
		expect(tryGetBlockKindDescriptor('paragraph')?.caretTargetAtPoint).toBeUndefined();
	});
});
