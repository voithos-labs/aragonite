// @vitest-environment jsdom
//
// The table is the only thing that knows where the caret is inside its grid, and the two ways a
// cell hands that over — focus notification and the exit gesture — are context calls with no
// return value, so what is asserted is the table's response. `internalStickyColumn` is
// deliberately NOT asserted: `getStickyColumn`/`resetStickyColumn` have no callers, so the field
// is write-only; the reset that IS observable, the focused-cell clear, is pinned below.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { vi } from 'vitest';
import { installTableLayoutStubs, mountTable, press, type MountedTable } from './mount-table';

let restoreLayout: () => void;
beforeAll(() => {
	restoreLayout = installTableLayoutStubs();
	return () => restoreLayout();
});

let mounted: MountedTable | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

// 3 rows × 2 columns; row 0 is the header, row 2 the last body row.
const GRID = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

function leaveFocus(from: HTMLElement, to: Node | null): void {
	from.dispatchEvent(
		new FocusEvent('focusout', { bubbles: true, relatedTarget: to as EventTarget })
	);
}

describe('the table tracks which of its cells holds the caret', () => {
	it('learns the focused cell from the cell itself', () => {
		mounted = mountTable(GRID);

		mounted.cell(1, 1).focus();

		expect(mounted.block.getCursorPosition!()?.path).toEqual([1, 1]);
	});

	it('forgets it when focus leaves the table', () => {
		mounted = mountTable(GRID);
		mounted.cell(1, 1).focus();

		leaveFocus(mounted.cell(1, 1), document.body);

		expect(mounted.block.getCursorPosition!()).toBeNull();
	});

	it('keeps it when focus moves between two of its own cells', () => {
		// The relatedTarget guard is the whole handler: without it, every Tab
		// between cells would blank the table's idea of where the caret is.
		mounted = mountTable(GRID);
		mounted.cell(1, 1).focus();

		leaveFocus(mounted.cell(1, 1), mounted.cell(2, 0));

		expect(mounted.block.getCursorPosition!()?.path).toEqual([1, 1]);
	});
});

describe('an arrow at the grid’s vertical edge leaves the table', () => {
	it('asks for the block below and captures a sticky column on the way down', async () => {
		mounted = mountTable(GRID);
		mounted.cell(2, 0).focus();

		await press(mounted.cell(2, 0), { key: 'ArrowDown' });

		expect(mounted.stickyColumn.capture).toHaveBeenCalled();
		expect(vi.mocked(mounted.focus.moveFocus)).toHaveBeenCalledWith(1, {
			stickyColumnFrom: 'above'
		});
	});

	it('asks for the block above on the way up', async () => {
		mounted = mountTable(GRID);
		mounted.cell(0, 1).focus();

		await press(mounted.cell(0, 1), { key: 'ArrowUp' });

		expect(vi.mocked(mounted.focus.moveFocus)).toHaveBeenCalledWith(-1, {
			stickyColumnFrom: 'below'
		});
	});

	it('stays inside the grid when the arrow has a row to move to', async () => {
		// Non-vacuity: the exit is edge-gated, so an interior arrow must move the
		// caret rather than ask the editor for a sibling block.
		mounted = mountTable(GRID);
		mounted.cell(1, 0).focus();

		await press(mounted.cell(1, 0), { key: 'ArrowDown' });

		expect(document.activeElement).toBe(mounted.cell(2, 0));
		expect(mounted.focus.moveFocus).not.toHaveBeenCalled();
	});
});
