// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerBuiltInBlocks } from '../../../components/built-in-blocks';
import { TABLE_CELL_SELECTOR } from '../../../components/block-content-selector';
import { tableDragHitTest } from '../../../components/blocks/table/table-drag-hit-test';
import { mountTableGrid } from '../../selection/table-grid';

registerBuiltInBlocks();
import { tryGetBlockKindDescriptor } from '../../../schema/block-kind-descriptor';

describe('table foreignDragHitTest', () => {
	let wrapper: HTMLElement;
	let cells: HTMLElement[][];
	const origFromPoint = document.elementFromPoint;

	beforeEach(() => {
		({ host: wrapper, cells } = mountTableGrid({ path: [0], rows: 2, cols: 3 }));
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

	it('hits a column header in row 0 the same as a body cell', () => {
		expect(cells[0][2].matches('[role="columnheader"]')).toBe(true);
		expect(wrapper.querySelectorAll(TABLE_CELL_SELECTOR)).toHaveLength(6);
		pointAt(cells[0][2]);
		expect(tableDragHitTest(wrapper, 0, 0)).toBe(2);
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
		// The column count must come from any mounted row, not from row 0 (VR-K1).
		cells[0][0].closest('[data-table-row-idx]')!.remove();
		pointAt(cells[1][2]); // row 1, col 2 → 1*3 + 2 = 5
		expect(tableDragHitTest(wrapper, 0, 0)).toBe(5);
	});
});
