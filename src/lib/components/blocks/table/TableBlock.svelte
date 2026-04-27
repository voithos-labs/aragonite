<script lang="ts">
	import { setContext, getContext } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		FOCUS_KEY,
		CONTAINER_EDIT_KEY,
		CONTROLLER_KEY,
		SELECTION_KEY,
		SELECTION_END,
		STICKY_COLUMN_KEY,
		TABLE_CONTEXT_KEY,
		type BlockEditActions,
		type ContainerEditActions,
		type CstNode,
		type FocusActions,
		type BlockComponent,
		type StickyColumnDirection,
		type TableContext,
		type CellPosition
	} from '../../../contracts';
	import type { TableMetadata } from '../../../core/nodes';
	import type { StickyColumnState } from '../../../cursor/sticky-column';
	import type { SelectionState } from '../../../selection/selection-state.svelte';
	import type { UndoController, MultiScopeTarget } from '../../../editor-actions/deps';
	import type { StructuralChange } from '../../../tree-operations/structural-change';
	import { pathsEqual } from '../../../selection/path-math';
	import { columnNearestX } from './cell-x-mapping';
	import { createBlockListState } from '../../../reactivity/block-list-state.svelte';
	import { expectStateForNode } from '../../../reactivity/state-registry';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from '../../../editor-actions/nested-actions';
	import {
		rebuildContainerRaw,
		rebuildTableRowRaw
	} from '../../../schema/container-raw';
	import {
		insertEmptyRow,
		insertEmptyColumn,
		deleteRow as mutDeleteRow,
		deleteColumn as mutDeleteColumn,
		cycleAlignment as mutCycleAlignment
	} from './table-mutations';
	import TableRowBlock from './TableRowBlock.svelte';

	let {
		node,
		index,
		myPath
	}: {
		node: CstNode;
		index: number;
		myPath: number[];
	} = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const controller = getContext<UndoController>(CONTROLLER_KEY);
	const editorStickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);
	const selection = getContext<SelectionState>(SELECTION_KEY);

	const meta = $derived(node.metadata as TableMetadata | undefined);
	const rowCount = $derived(node.children?.length ?? 0);
	const columnCount = $derived(meta?.columnCount ?? 1);

	let internalStickyColumn: number | null = $state(null);
	let focusedCell: { rowIdx: number; colIdx: number } | null = $state(null);
	let tableEl: HTMLDivElement | undefined = $state();

	const rowsState = createBlockListState(() => node);

	const bundle = createStandardNestedActions(rowsState, {
		get index() {
			return index;
		},
		get node() {
			return node;
		},
		rebuildRaw: () => rebuildContainerRaw(node),
		stickyColumn: editorStickyColumn,
		parent: {
			blockEdit: parentBlockEdit,
			focus: focusActions,
			containerEdit: parentContainerEdit
		}
	});

	setNestedActionsContexts(bundle);

	function rowRefAt(rowIdx: number): BlockComponent | undefined {
		return rowsState.innerBlockRefs[rowIdx];
	}

	function offsetForPosition(position: CellPosition): number {
		if (position === 'start') return 0;
		if (position === 'end') return Number.MAX_SAFE_INTEGER;
		return position;
	}

	// ── TableContext implementation ────────────────────────────────────────

	const ctx: TableContext = {
		focusCell(rowIdx, colIdx, position) {
			rowRefAt(rowIdx)?.focusByPath?.([colIdx], offsetForPosition(position));
		},
		getStickyColumn() {
			return internalStickyColumn;
		},
		setStickyColumn(colIdx) {
			internalStickyColumn = colIdx;
		},
		resetStickyColumn() {
			internalStickyColumn = null;
		},
		exitUpward(stickyX) {
			editorStickyColumn.capture(stickyX);
			internalStickyColumn = null;
			focusActions.moveFocus(myPath[myPath.length - 1] - 1, 'end');
		},
		exitDownward(stickyX) {
			editorStickyColumn.capture(stickyX);
			internalStickyColumn = null;
			focusActions.moveFocus(myPath[myPath.length - 1] + 1, 'start');
		},
		notifyCellFocused(rowIdx, colIdx) {
			focusedCell = { rowIdx, colIdx };
		},
		notifyCellBlurred() {
			focusedCell = null;
		},
		insertRowAbove: (rowIdx) => insertRow(rowIdx, 'above'),
		insertRowBelow: (rowIdx) => insertRow(rowIdx, 'below'),
		insertColumnLeft: (colIdx) => insertColumn(colIdx, 'left'),
		insertColumnRight: (colIdx) => insertColumn(colIdx, 'right'),
		async deleteRow(rowIdx) {
			if ((node.children?.length ?? 0) <= 1) return;
			const willRemoveHeader = rowIdx === 0;
			const bodyCount = (node.children?.length ?? 0) - 1;
			if (!willRemoveHeader && bodyCount <= 1) return;
			await parentContainerEdit.commitContainer({
				containerNode: node,
				state: rowsState,
				snapshot: { blockIndex: index, offset: 0 },
				mutate: (children) => {
					mutDeleteRow(node, rowIdx);
					children.length = 0;
					children.push(...node.children!);
					rebuildContainerRaw(node);
					return { op: 'delete', at: rowIdx, count: 1 };
				},
				op: { kind: 'tableDeleteRow', detail: { rowIdx }, eventPath: [index, rowIdx] },
				afterTick: () => {
					const newRowCount = node.children?.length ?? 0;
					if (newRowCount === 0) return;
					const targetRow = Math.min(rowIdx, newRowCount - 1);
					const targetCol = focusedCell ? Math.min(focusedCell.colIdx, columnCount - 1) : 0;
					ctx.focusCell(targetRow, targetCol, 'start');
				}
			});
		},
		async deleteColumn(colIdx) {
			const tableMeta = node.metadata as TableMetadata;
			if (tableMeta.columnCount <= 1) return;
			const rows = node.children ?? [];
			const scopes: MultiScopeTarget[] = [
				{ node, state: rowsState },
				...rows.map((row) => ({ node: row, state: expectStateForNode(row) }))
			];
			await controller.commitMultiScope({
				scopes,
				snapshot: { blockIndex: index, offset: 0 },
				mutate: (scopeChildren) => {
					mutDeleteColumn(node, colIdx);
					syncScopeChildren(scopeChildren);
					for (const row of node.children ?? []) rebuildTableRowRaw(row);
					rebuildContainerRaw(node);
					const rowChanges = (node.children ?? []).map(
						(): StructuralChange => ({ op: 'delete', at: colIdx, count: 1 })
					);
					return [{ op: 'noop' }, ...rowChanges];
				},
				op: { kind: 'tableDeleteColumn', detail: { colIdx }, eventPath: myPath },
				afterTick: () => {
					const newColumnCount = (node.metadata as TableMetadata).columnCount;
					if (newColumnCount === 0) return;
					const targetCol = Math.min(colIdx, newColumnCount - 1);
					const targetRow = focusedCell?.rowIdx ?? 0;
					ctx.focusCell(targetRow, targetCol, 'start');
				}
			});
		},
		async cycleAlignment(colIdx) {
			await parentContainerEdit.commitContainer({
				containerNode: node,
				state: rowsState,
				snapshot: { blockIndex: index, offset: 0 },
				mutate: () => {
					mutCycleAlignment(node, colIdx);
					rebuildContainerRaw(node);
					return { op: 'noop' };
				},
				op: { kind: 'tableCycleAlignment', detail: { colIdx }, eventPath: [index, colIdx] }
			});
		}
	};

	async function insertRow(rowIdx: number, side: 'above' | 'below'): Promise<void> {
		const insertAt = side === 'above' ? rowIdx : rowIdx + 1;
		await parentContainerEdit.commitContainer({
			containerNode: node,
			state: rowsState,
			snapshot: { blockIndex: index, offset: 0 },
			mutate: (children) => {
				insertEmptyRow(node, rowIdx, side);
				rebuildTableRowRaw(node.children![insertAt]);
				children.length = 0;
				children.push(...node.children!);
				rebuildContainerRaw(node);
				return { op: 'insert', at: insertAt, count: 1 };
			},
			op: { kind: 'tableInsertRow', detail: { rowIdx, side }, eventPath: [index, insertAt] },
			afterTick: () => ctx.focusCell(insertAt, 0, 'start')
		});
	}

	async function insertColumn(colIdx: number, side: 'left' | 'right'): Promise<void> {
		const insertAt = side === 'left' ? colIdx : colIdx + 1;
		const rows = node.children ?? [];
		const scopes: MultiScopeTarget[] = [
			{ node, state: rowsState },
			...rows.map((row) => ({ node: row, state: expectStateForNode(row) }))
		];
		await controller.commitMultiScope({
			scopes,
			snapshot: { blockIndex: index, offset: 0 },
			mutate: (scopeChildren) => {
				insertEmptyColumn(node, colIdx, side);
				syncScopeChildren(scopeChildren);
				for (const row of node.children ?? []) rebuildTableRowRaw(row);
				rebuildContainerRaw(node);
				const rowChanges = (node.children ?? []).map(
					(): StructuralChange => ({ op: 'insert', at: insertAt, count: 1 })
				);
				return [{ op: 'noop' }, ...rowChanges];
			},
			op: { kind: 'tableInsertColumn', detail: { colIdx, side }, eventPath: myPath },
			afterTick: () => {
				const targetRow = focusedCell?.rowIdx ?? 0;
				ctx.focusCell(targetRow, insertAt, 'start');
			}
		});
	}

	// Multi-scope mutate gets per-scope children copies; the table mutation
	// helpers operate on node.children directly, so re-publish each scope from
	// the live tree before returning.
	function syncScopeChildren(scopeChildren: { children: CstNode[] }[]): void {
		const tableScope = scopeChildren[0];
		tableScope.children.length = 0;
		tableScope.children.push(...(node.children ?? []));
		const rows = node.children ?? [];
		for (let i = 0; i < rows.length; i++) {
			const rowScope = scopeChildren[i + 1];
			rowScope.children.length = 0;
			rowScope.children.push(...(rows[i].children ?? []));
		}
	}

	setContext(TABLE_CONTEXT_KEY, ctx);

	// ── focusout: reset internal sticky when focus leaves the table ────────

	$effect(() => {
		if (!tableEl) return;
		const el = tableEl;
		const handler = (e: FocusEvent) => {
			const next = e.relatedTarget as Node | null;
			if (next && el.contains(next)) return;
			internalStickyColumn = null;
			focusedCell = null;
		};
		el.addEventListener('focusout', handler);
		return () => el.removeEventListener('focusout', handler);
	});

	// ── BlockComponent interface ───────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export function focus(offset: number): void {
		if (rowCount === 0) return;
		if (offset === 0) {
			ctx.focusCell(0, 0, 'start');
			return;
		}
		const cellCount = columnCount * rowCount;
		if (offset >= cellCount) {
			ctx.focusCell(rowCount - 1, columnCount - 1, 'end');
			return;
		}
		// Half-open cell-index convention: offset N (1..cellCount-1) lands at cell N-1 'start'.
		const cellIdx = offset - 1;
		ctx.focusCell(Math.floor(cellIdx / columnCount), cellIdx % columnCount, 'start');
	}

	export function focusAtColumn(x: number, from: StickyColumnDirection): void {
		if (rowCount === 0) return;
		const targetRow = from === 'above' ? 0 : rowCount - 1;
		const colIdx = columnNearestX(x, collectColumnRects());
		internalStickyColumn = colIdx;
		ctx.focusCell(targetRow, colIdx, 'start');
	}

	export function focusByPath(path: number[], offset: number): void {
		const [rowIdx, colIdx, ...rest] = path;
		rowRefAt(rowIdx)?.focusByPath?.([colIdx, ...rest], offset);
	}

	export function getCursorOffset(): number | null {
		if (!focusedCell) return null;
		return focusedCell.rowIdx * columnCount + focusedCell.colIdx;
	}

	export function getCursorPosition(): { path: number[]; offset: number } | null {
		if (!focusedCell) return null;
		// offset is intentionally 0 — intra-cell precision lands when undo restoration needs it.
		return { path: [focusedCell.rowIdx, focusedCell.colIdx], offset: 0 };
	}

	export function measurePartialRects(start: number, end: number): DOMRect[] {
		if (!tableEl || rowCount === 0) return [];
		const cells = collectSelectedCells(start, end);
		const rects: DOMRect[] = [];
		for (const { rowIdx, colIdx } of cells) {
			const cellEl = cellElementAt(rowIdx, colIdx);
			if (!cellEl) continue;
			rects.push(cellEl.getBoundingClientRect());
		}
		return rects;
	}

	function collectSelectedCells(start: number, end: number): { rowIdx: number; colIdx: number }[] {
		const anchor = selection?.anchor;
		const focus = selection?.focus;
		const isRectangular =
			selection?.isCustomRendered &&
			!!anchor &&
			!!focus &&
			pathsEqual(anchor.path, focus.path);

		if (isRectangular) {
			const aRow = Math.floor(anchor.offset / columnCount);
			const aCol = anchor.offset % columnCount;
			const fRow = Math.floor(focus.offset / columnCount);
			const fCol = focus.offset % columnCount;
			const minRow = Math.min(aRow, fRow);
			const maxRow = Math.max(aRow, fRow);
			const minCol = Math.min(aCol, fCol);
			const maxCol = Math.max(aCol, fCol);
			const cells: { rowIdx: number; colIdx: number }[] = [];
			for (let r = minRow; r <= maxRow; r++) {
				for (let c = minCol; c <= maxCol; c++) {
					cells.push({ rowIdx: r, colIdx: c });
				}
			}
			return cells;
		}

		const cellCount = rowCount * columnCount;
		const linearEnd = end === SELECTION_END ? cellCount : Math.min(end, cellCount);
		const linearStart = Math.max(0, start);
		const cells: { rowIdx: number; colIdx: number }[] = [];
		for (let i = linearStart; i < linearEnd; i++) {
			cells.push({ rowIdx: Math.floor(i / columnCount), colIdx: i % columnCount });
		}
		return cells;
	}

	function cellElementAt(rowIdx: number, colIdx: number): HTMLElement | null {
		if (!tableEl) return null;
		if (rowIdx < 0 || rowIdx >= rowCount || colIdx < 0 || colIdx >= columnCount) return null;
		const rowEl = tableEl.querySelector(`:scope > [data-table-row-idx="${rowIdx}"]`);
		if (!rowEl) return null;
		const cells = rowEl.querySelectorAll(':scope > .table-cell');
		return (cells[colIdx] as HTMLElement) ?? null;
	}

	void ({
		editable,
		focusable,
		focus,
		focusAtColumn,
		focusByPath,
		getCursorOffset,
		getCursorPosition,
		measurePartialRects
	} satisfies BlockComponent);

	function collectColumnRects(): { left: number; right: number }[] {
		if (!tableEl || rowCount === 0) return [];
		const firstRowEl = tableEl.querySelector(':scope > [data-table-row-idx="0"]');
		if (!firstRowEl) return [];
		const tableRect = tableEl.getBoundingClientRect();
		const cells = Array.from(firstRowEl.querySelectorAll(':scope > .table-cell'));
		return cells.map((c) => {
			const r = (c as HTMLElement).getBoundingClientRect();
			return { left: r.left - tableRect.left, right: r.right - tableRect.left };
		});
	}
</script>

<div
	bind:this={tableEl}
	class="table-block"
	role="table"
	style:grid-template-columns={`repeat(${columnCount}, auto)`}
>
	{#each node.children ?? [] as rowNode, rowIdx (rowsState.innerBlockIds[rowIdx])}
		<TableRowBlock
			node={rowNode}
			index={rowIdx}
			{rowIdx}
			{columnCount}
			{rowCount}
			myPath={[...myPath, rowIdx]}
			bind:this={rowsState.innerBlockRefs[rowIdx]}
		/>
	{/each}
</div>

<style>
	.table-block {
		display: grid;
		width: 100%;
		overflow-x: auto;
	}
</style>
