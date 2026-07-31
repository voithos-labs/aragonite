import { describe, it, expect } from 'vitest';
import {
	tableMenuItems,
	type TableMenuItem
} from '../../../components/blocks/table/table-menu-model';
import type { TableAxisAction } from '../../../action-contracts';

type ActionItem = Extract<TableMenuItem, { kind: 'action' }>;

const actionItem = (items: TableMenuItem[], action: TableAxisAction): ActionItem | undefined =>
	items.find((i): i is ActionItem => i.kind === 'action' && i.action === action);

const hasAction = (items: TableMenuItem[], action: TableAxisAction): boolean =>
	items.some((i) => i.kind === 'action' && i.action === action);

describe('tableMenuItems: delete enablement', () => {
	it('disables delete-column at the last column, enables it otherwise', () => {
		expect(
			actionItem(
				tableMenuItems({ colIdx: 0 }, { rowCount: 2, colCount: 1 }, ['none']),
				'deleteColumn'
			)?.enabled
		).toBe(false);
		expect(
			actionItem(
				tableMenuItems({ colIdx: 0 }, { rowCount: 2, colCount: 2 }, ['none', 'none']),
				'deleteColumn'
			)?.enabled
		).toBe(true);
	});

	it('disables delete-row for the only body row, enables it with two body rows', () => {
		expect(
			actionItem(
				tableMenuItems({ rowIdx: 1 }, { rowCount: 2, colCount: 2 }, ['none', 'none']),
				'deleteRow'
			)?.enabled
		).toBe(false);
		expect(
			actionItem(
				tableMenuItems({ rowIdx: 1 }, { rowCount: 3, colCount: 2 }, ['none', 'none']),
				'deleteRow'
			)?.enabled
		).toBe(true);
	});

	// The wrapper promotes the next row to header, so a header delete only needs a
	// second row — unlike a body delete at the same dims, which is refused.
	it('allows a header delete even when one body row remains', () => {
		expect(
			actionItem(
				tableMenuItems({ rowIdx: 0 }, { rowCount: 2, colCount: 2 }, ['none', 'none']),
				'deleteRow'
			)?.enabled
		).toBe(true);
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
			const items = tableMenuItems({ rowIdx }, { rowCount, colCount: 2 }, ['none', 'none']);
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
			const items = tableMenuItems({ colIdx }, { rowCount: 2, colCount }, ['none', 'none', 'none']);
			expect(actionItem(items, 'moveColumnLeft')?.enabled).toBe(left);
			expect(actionItem(items, 'moveColumnRight')?.enabled).toBe(right);
		});
	}
});

describe('tableMenuItems: inserts and alignment', () => {
	it('keeps inserts enabled at single-row / single-column boundaries', () => {
		const rowItems = tableMenuItems({ rowIdx: 0 }, { rowCount: 1, colCount: 1 }, ['none']);
		expect(actionItem(rowItems, 'insertRowAbove')?.enabled).toBe(true);
		expect(actionItem(rowItems, 'insertRowBelow')?.enabled).toBe(true);
		const colItems = tableMenuItems({ colIdx: 0 }, { rowCount: 1, colCount: 1 }, ['none']);
		expect(actionItem(colItems, 'insertColumnLeft')?.enabled).toBe(true);
		expect(actionItem(colItems, 'insertColumnRight')?.enabled).toBe(true);
	});

	it('surfaces the target column current alignment as the last column item', () => {
		const items = tableMenuItems({ colIdx: 1 }, { rowCount: 2, colCount: 2 }, ['none', 'center']);
		expect(items.find((i) => i.kind === 'alignment')).toMatchObject({ current: 'center' });
		expect(items.at(-1)).toEqual({ kind: 'alignment', current: 'center' });
	});

	// Alignment is the dedicated 'alignment' item; cycleAlignment must never leak
	// in as an action, even if the groups are refactored to iterate the union.
	it('never emits cycleAlignment as an action', () => {
		const items = tableMenuItems({ rowIdx: 1, colIdx: 0 }, { rowCount: 3, colCount: 2 }, [
			'none',
			'none'
		]);
		expect(hasAction(items, 'cycleAlignment')).toBe(false);
	});
});

describe('tableMenuItems: action items carry their own axis index', () => {
	const rowActions: TableAxisAction[] = [
		'insertRowAbove',
		'insertRowBelow',
		'moveRowUp',
		'moveRowDown',
		'deleteRow'
	];
	const colActions: TableAxisAction[] = [
		'insertColumnLeft',
		'insertColumnRight',
		'moveColumnLeft',
		'moveColumnRight',
		'deleteColumn'
	];

	// A both-axes cell menu mixes the groups, so the dispatcher routes each item by its own index —
	// row actions to rowIdx, column actions to colIdx. Distinct values catch a crossed-wires bug.
	it('routes a both-axes cell target by group: rowIdx for rows, colIdx for columns', () => {
		const items = tableMenuItems({ rowIdx: 1, colIdx: 0 }, { rowCount: 3, colCount: 2 }, [
			'none',
			'none'
		]);
		for (const action of rowActions) expect(actionItem(items, action)?.index).toBe(1);
		for (const action of colActions) expect(actionItem(items, action)?.index).toBe(0);
	});

	it('stamps every action with the lone axis index for a single-axis grip target', () => {
		const rowItems = tableMenuItems({ rowIdx: 2 }, { rowCount: 4, colCount: 2 }, ['none', 'none']);
		for (const action of rowActions) expect(actionItem(rowItems, action)?.index).toBe(2);
		const colItems = tableMenuItems({ colIdx: 3 }, { rowCount: 2, colCount: 5 }, [
			'none',
			'none',
			'none',
			'none',
			'none'
		]);
		for (const action of colActions) expect(actionItem(colItems, action)?.index).toBe(3);
	});
});

describe('tableMenuItems: clipboard group', () => {
	type ClipboardItem = Extract<TableMenuItem, { kind: 'clipboard' }>;
	const clipActions = ['cut', 'copy', 'paste'] as const;
	const clipItem = (
		items: TableMenuItem[],
		action: (typeof clipActions)[number]
	): ClipboardItem | undefined =>
		items.find((i): i is ClipboardItem => i.kind === 'clipboard' && i.action === action);

	it('prepends Cut/Copy/Paste then a separator for a cell target, ahead of the row group', () => {
		const items = tableMenuItems(
			{ rowIdx: 1, colIdx: 0 },
			{ rowCount: 3, colCount: 2 },
			['none', 'none'],
			{ hasSelection: true }
		);
		for (const action of clipActions) expect(clipItem(items, action)).toBeDefined();
		const lastClip = items.findIndex((i) => i.kind === 'clipboard' && i.action === 'paste');
		const firstSep = items.findIndex((i) => i.kind === 'separator');
		const rowAction = items.findIndex((i) => i.kind === 'action' && i.action === 'deleteRow');
		expect(lastClip).toBeLessThan(firstSep);
		expect(firstSep).toBeLessThan(rowAction);
	});

	it('disables Cut/Copy without a selection but keeps Paste enabled', () => {
		const items = tableMenuItems(
			{ rowIdx: 1, colIdx: 0 },
			{ rowCount: 3, colCount: 2 },
			['none', 'none'],
			{ hasSelection: false }
		);
		expect(clipItem(items, 'cut')?.enabled).toBe(false);
		expect(clipItem(items, 'copy')?.enabled).toBe(false);
		expect(clipItem(items, 'paste')?.enabled).toBe(true);
	});

	it('enables Cut/Copy with a selection', () => {
		const items = tableMenuItems(
			{ rowIdx: 1, colIdx: 0 },
			{ rowCount: 3, colCount: 2 },
			['none', 'none'],
			{ hasSelection: true }
		);
		expect(clipItem(items, 'cut')?.enabled).toBe(true);
		expect(clipItem(items, 'copy')?.enabled).toBe(true);
	});

	// An intra-table rectangle suppresses the cell's native selection, so hasSelection
	// is false; the rect is exactly what Cut/Copy exist to serve, so they enable on it.
	it('enables Cut/Copy for an active rectangle with no cell selection', () => {
		const items = tableMenuItems(
			{ rowIdx: 1, colIdx: 0 },
			{ rowCount: 3, colCount: 2 },
			['none', 'none'],
			{ hasSelection: false, hasRect: true }
		);
		expect(clipItem(items, 'cut')?.enabled).toBe(true);
		expect(clipItem(items, 'copy')?.enabled).toBe(true);
	});

	it('omits clipboard items for single-axis grip targets even when clipboard info is passed', () => {
		const rowItems = tableMenuItems({ rowIdx: 1 }, { rowCount: 3, colCount: 2 }, ['none', 'none'], {
			hasSelection: true
		});
		const colItems = tableMenuItems({ colIdx: 0 }, { rowCount: 3, colCount: 2 }, ['none', 'none'], {
			hasSelection: true
		});
		expect(rowItems.some((i) => i.kind === 'clipboard')).toBe(false);
		expect(colItems.some((i) => i.kind === 'clipboard')).toBe(false);
	});

	it('omits clipboard items for a cell target when no clipboard info is passed', () => {
		const items = tableMenuItems({ rowIdx: 1, colIdx: 0 }, { rowCount: 3, colCount: 2 }, [
			'none',
			'none'
		]);
		expect(items.some((i) => i.kind === 'clipboard')).toBe(false);
	});
});

describe('tableMenuItems: group selection by target shape', () => {
	it('a row-only target emits the row group with no column items or separator', () => {
		const items = tableMenuItems({ rowIdx: 1 }, { rowCount: 3, colCount: 2 }, ['none', 'none']);
		expect(hasAction(items, 'deleteRow')).toBe(true);
		expect(hasAction(items, 'deleteColumn')).toBe(false);
		expect(items.some((i) => i.kind === 'separator')).toBe(false);
	});

	it('a column-only target emits the column group with no row items or separator', () => {
		const items = tableMenuItems({ colIdx: 0 }, { rowCount: 3, colCount: 2 }, ['none', 'none']);
		expect(hasAction(items, 'deleteColumn')).toBe(true);
		expect(hasAction(items, 'deleteRow')).toBe(false);
		expect(items.some((i) => i.kind === 'separator')).toBe(false);
	});

	it('a cell target emits the row group, a separator, then the column group in order', () => {
		const items = tableMenuItems({ rowIdx: 1, colIdx: 0 }, { rowCount: 3, colCount: 2 }, [
			'none',
			'none'
		]);
		const sepIdx = items.findIndex((i) => i.kind === 'separator');
		const delRowIdx = items.findIndex((i) => i.kind === 'action' && i.action === 'deleteRow');
		const delColIdx = items.findIndex((i) => i.kind === 'action' && i.action === 'deleteColumn');
		expect(sepIdx).toBeGreaterThan(-1);
		expect(delRowIdx).toBeLessThan(sepIdx);
		expect(delColIdx).toBeGreaterThan(sepIdx);
	});
});
