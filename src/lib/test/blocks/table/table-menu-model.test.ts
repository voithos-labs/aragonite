import { describe, it, expect } from 'vitest';
import {
	flyoutPlacement,
	tableMenuItems,
	type TableMenuItem
} from '../../../components/blocks/table/table-menu-model';
import type { TableAxisAction } from '../../../action-contracts';
import type { TableAlignment } from '../../../core/nodes';

type ActionItem = Extract<TableMenuItem, { kind: 'action' }>;
type ClipboardItem = Extract<TableMenuItem, { kind: 'clipboard' }>;

const PLAIN: readonly TableAlignment[] = ['none', 'none', 'none', 'none', 'none'];

function menuFor(
	cell: { rowIdx: number; colIdx: number },
	dims: { rowCount: number; colCount: number },
	alignments: readonly TableAlignment[] = PLAIN,
	clipboard: { hasSelection: boolean; hasRect?: boolean } = { hasSelection: false }
): TableMenuItem[] {
	return tableMenuItems(cell, dims, alignments, clipboard);
}

/** The list with every flyout opened into it, so enablement reads the same either way. */
const flat = (items: TableMenuItem[]): TableMenuItem[] =>
	items.flatMap((i) => (i.kind === 'group' ? flat(i.items) : [i]));

const actionItem = (items: TableMenuItem[], action: TableAxisAction): ActionItem | undefined =>
	flat(items).find((i): i is ActionItem => i.kind === 'action' && i.action === action);

const hasAction = (items: TableMenuItem[], action: TableAxisAction): boolean =>
	flat(items).some((i) => i.kind === 'action' && i.action === action);

const clipItem = (items: TableMenuItem[], action: ClipboardItem['action']) =>
	items.find((i): i is ClipboardItem => i.kind === 'clipboard' && i.action === action);

describe('tableMenuItems: delete enablement', () => {
	it('disables delete-column at the last column, enables it otherwise', () => {
		const one = menuFor({ rowIdx: 1, colIdx: 0 }, { rowCount: 2, colCount: 1 });
		expect(actionItem(one, 'deleteColumn')?.enabled).toBe(false);
		const two = menuFor({ rowIdx: 1, colIdx: 0 }, { rowCount: 2, colCount: 2 });
		expect(actionItem(two, 'deleteColumn')?.enabled).toBe(true);
	});

	it('disables delete-row for the only body row, enables it with two body rows', () => {
		const one = menuFor({ rowIdx: 1, colIdx: 0 }, { rowCount: 2, colCount: 2 });
		expect(actionItem(one, 'deleteRow')?.enabled).toBe(false);
		const two = menuFor({ rowIdx: 1, colIdx: 0 }, { rowCount: 3, colCount: 2 });
		expect(actionItem(two, 'deleteRow')?.enabled).toBe(true);
	});

	// The wrapper promotes the next row to header, so a header delete only needs a
	// second row — unlike a body delete at the same dims, which is refused.
	it('allows a header delete even when one body row remains', () => {
		const items = menuFor({ rowIdx: 0, colIdx: 0 }, { rowCount: 2, colCount: 2 });
		expect(actionItem(items, 'deleteRow')?.enabled).toBe(true);
	});
});

describe('tableMenuItems: move enablement', () => {
	const rows: Array<[string, number, number, boolean, boolean]> = [
		['header row never moves', 0, 4, false, false],
		['first body row cannot move up over the header', 1, 4, false, true],
		['interior body row moves both ways', 2, 4, true, true],
		['last body row cannot move down', 3, 4, true, false]
	];
	for (const [name, rowIdx, rowCount, up, down] of rows) {
		it(`row: ${name}`, () => {
			const items = menuFor({ rowIdx, colIdx: 0 }, { rowCount, colCount: 2 });
			expect(actionItem(items, 'moveRowUp')?.enabled).toBe(up);
			expect(actionItem(items, 'moveRowDown')?.enabled).toBe(down);
		});
	}

	const cols: Array<[string, number, number, boolean, boolean]> = [
		['first column cannot move left', 0, 3, false, true],
		['interior column moves both ways', 1, 3, true, true],
		['last column cannot move right', 2, 3, true, false]
	];
	for (const [name, colIdx, colCount, left, right] of cols) {
		it(`column: ${name}`, () => {
			const items = menuFor({ rowIdx: 1, colIdx }, { rowCount: 2, colCount });
			expect(actionItem(items, 'moveColumnLeft')?.enabled).toBe(left);
			expect(actionItem(items, 'moveColumnRight')?.enabled).toBe(right);
		});
	}
});

describe('tableMenuItems: inserts and alignment', () => {
	it('keeps inserts enabled at single-row / single-column boundaries', () => {
		const items = menuFor({ rowIdx: 0, colIdx: 0 }, { rowCount: 1, colCount: 1 });
		for (const action of [
			'insertRowAbove',
			'insertRowBelow',
			'insertColumnLeft',
			'insertColumnRight'
		] as const) {
			expect(actionItem(items, action)?.enabled).toBe(true);
		}
	});

	it('surfaces the target column current alignment as the last item', () => {
		const items = menuFor({ rowIdx: 1, colIdx: 1 }, { rowCount: 2, colCount: 2 }, [
			'none',
			'center'
		]);
		expect(items.at(-1)).toEqual({ kind: 'alignment', current: 'center' });
	});

	// Alignment is the dedicated 'alignment' item; cycleAlignment must never leak
	// in as an action, even if the groups are refactored to iterate the union.
	it('never emits cycleAlignment as an action', () => {
		const items = menuFor({ rowIdx: 1, colIdx: 0 }, { rowCount: 3, colCount: 2 });
		expect(hasAction(items, 'cycleAlignment')).toBe(false);
	});
});

// A cell menu mixes the groups, so the dispatcher routes each item by its own index — row
// actions to rowIdx, column actions to colIdx. Distinct values catch a crossed-wires bug.
describe('tableMenuItems: action items carry their own axis index', () => {
	it('routes row actions by rowIdx and column actions by colIdx', () => {
		const items = menuFor({ rowIdx: 1, colIdx: 0 }, { rowCount: 3, colCount: 2 });
		const rowActions = [
			'insertRowAbove',
			'insertRowBelow',
			'moveRowUp',
			'moveRowDown',
			'deleteRow'
		];
		const colActions = [
			'insertColumnLeft',
			'insertColumnRight',
			'moveColumnLeft',
			'moveColumnRight',
			'deleteColumn'
		];
		for (const action of rowActions as TableAxisAction[]) {
			expect(actionItem(items, action)?.index).toBe(1);
		}
		for (const action of colActions as TableAxisAction[]) {
			expect(actionItem(items, action)?.index).toBe(0);
		}
	});
});

describe('tableMenuItems: clipboard group', () => {
	const dims = { rowCount: 3, colCount: 2 };
	const cell = { rowIdx: 1, colIdx: 0 };

	it('leads with Cut/Copy/Paste then a separator, ahead of the row group', () => {
		const items = menuFor(cell, dims, PLAIN, { hasSelection: true });
		const lastClip = items.findIndex((i) => i.kind === 'clipboard' && i.action === 'paste');
		const firstSep = items.findIndex((i) => i.kind === 'separator');
		const rowGroup = items.findIndex((i) => i.kind === 'group' && i.id === 'row');
		expect(lastClip).toBeGreaterThanOrEqual(0);
		expect(lastClip).toBeLessThan(firstSep);
		expect(firstSep).toBeLessThan(rowGroup);
	});

	it('disables Cut/Copy without a selection but keeps Paste enabled', () => {
		const items = menuFor(cell, dims, PLAIN, { hasSelection: false });
		expect(clipItem(items, 'cut')?.enabled).toBe(false);
		expect(clipItem(items, 'copy')?.enabled).toBe(false);
		expect(clipItem(items, 'paste')?.enabled).toBe(true);
	});

	it('enables Cut/Copy with a selection', () => {
		const items = menuFor(cell, dims, PLAIN, { hasSelection: true });
		expect(clipItem(items, 'cut')?.enabled).toBe(true);
		expect(clipItem(items, 'copy')?.enabled).toBe(true);
	});

	// An intra-table rectangle suppresses the cell's native selection, so hasSelection
	// is false; the rect is exactly what Cut/Copy exist to serve, so they enable on it.
	it('enables Cut/Copy for an active rectangle with no cell selection', () => {
		const items = menuFor(cell, dims, PLAIN, { hasSelection: false, hasRect: true });
		expect(clipItem(items, 'cut')?.enabled).toBe(true);
		expect(clipItem(items, 'copy')?.enabled).toBe(true);
	});
});

describe('tableMenuItems: shape', () => {
	it('folds each axis behind a flyout and keeps the deletes and alignment in the list', () => {
		const items = menuFor({ rowIdx: 1, colIdx: 0 }, { rowCount: 3, colCount: 2 });
		const kinds = items.map((i) => (i.kind === 'group' ? `group:${i.id}` : i.kind));
		expect(kinds).toEqual([
			'clipboard',
			'clipboard',
			'clipboard',
			'separator',
			'group:row',
			'group:column',
			'separator',
			'action',
			'action',
			'alignment'
		]);
		const rowGroup = items[4];
		const colGroup = items[5];
		if (rowGroup.kind !== 'group' || colGroup.kind !== 'group') throw new Error('groups');
		expect(rowGroup.items.map((i) => (i.kind === 'action' ? i.action : i.kind))).toEqual([
			'insertRowAbove',
			'insertRowBelow',
			'moveRowUp',
			'moveRowDown'
		]);
		expect(colGroup.items.map((i) => (i.kind === 'action' ? i.action : i.kind))).toEqual([
			'insertColumnLeft',
			'insertColumnRight',
			'moveColumnLeft',
			'moveColumnRight'
		]);
		expect(items[7]).toMatchObject({ kind: 'action', action: 'deleteRow' });
		expect(items[8]).toMatchObject({ kind: 'action', action: 'deleteColumn' });
	});
});

describe('flyoutPlacement', () => {
	const viewport = { width: 1000, height: 600 };

	it('shifts a flyout up just enough to clear the viewport bottom', () => {
		const at = { top: 500, bottom: 700, right: 400, width: 200 };
		expect(flyoutPlacement(at, { left: 100 }, viewport)).toEqual({ dy: -108, flip: false });
	});

	it('never shifts above the top margin', () => {
		const at = { top: 20, bottom: 800, right: 400, width: 200 };
		expect(flyoutPlacement(at, { left: 100 }, viewport).dy).toBe(-12);
	});

	it("flips to the parent menu's left when the right edge overflows and the left fits", () => {
		const at = { top: 100, bottom: 300, right: 1100, width: 200 };
		expect(flyoutPlacement(at, { left: 700 }, viewport)).toEqual({ dy: 0, flip: true });
		expect(flyoutPlacement(at, { left: 100 }, viewport).flip).toBe(false);
	});
});
