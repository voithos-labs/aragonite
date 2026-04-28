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
	import type { UndoController } from '../../../editor-actions/deps';
	import { pathsEqual } from '../../../selection/path-math';
	import { columnNearestX } from './cell-x-mapping';
	import { createBlockListState } from '../../../reactivity/block-list-state.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from '../../../editor-actions/nested-actions';
	import { rebuildContainerRaw } from '../../../schema/container-raw';
	import { createTableMutationsContext } from '../../../editor-actions/table-context';
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

	const meta = $derived(node.metadata as TableMetadata);
	const rowCount = $derived(node.children?.length ?? 0);
	const columnCount = $derived(meta.columnCount);

	// Plain `let`, not $state: writes happen during keyed-each reconcile via
	// the focusout handler, which Svelte 5 traps as state_unsafe_mutation.
	let internalStickyColumn: number | null = null;
	let focusedCell: { rowIdx: number; colIdx: number } | null = null;
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

	function focusCell(rowIdx: number, colIdx: number, position: CellPosition): void {
		rowRefAt(rowIdx)?.focusByPath?.([colIdx], offsetForPosition(position));
	}

	const mutations = createTableMutationsContext({
		get node() {
			return node;
		},
		get index() {
			return index;
		},
		get myPath() {
			return myPath;
		},
		get rowsState() {
			return rowsState;
		},
		get focusedCell() {
			return focusedCell;
		},
		parentContainerEdit,
		controller,
		focusCell
	});

	const ctx: TableContext = {
		focusCell,
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
			focusActions.moveFocus(myPath[myPath.length - 1] - 1, {
				stickyColumnFrom: 'below'
			});
		},
		exitDownward(stickyX) {
			editorStickyColumn.capture(stickyX);
			internalStickyColumn = null;
			focusActions.moveFocus(myPath[myPath.length - 1] + 1, {
				stickyColumnFrom: 'above'
			});
		},
		notifyCellFocused(rowIdx, colIdx) {
			focusedCell = { rowIdx, colIdx };
		},
		notifyCellBlurred() {
			focusedCell = null;
		},
		...mutations
	};

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
			focusCell(0, 0, 'start');
			return;
		}
		const cellCount = columnCount * rowCount;
		if (offset >= cellCount) {
			focusCell(rowCount - 1, columnCount - 1, 'end');
			return;
		}
		// Half-open cell-index convention: offset N (1..cellCount-1) lands at cell N-1 'start'.
		const cellIdx = offset - 1;
		focusCell(Math.floor(cellIdx / columnCount), cellIdx % columnCount, 'start');
	}

	export function focusAtColumn(x: number, from: StickyColumnDirection): void {
		if (rowCount === 0) return;
		const targetRow = from === 'above' ? 0 : rowCount - 1;
		const colIdx = columnNearestX(x, collectColumnRects());
		internalStickyColumn = colIdx;
		focusCell(targetRow, colIdx, 'start');
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
		const { rowIdx, colIdx } = focusedCell;
		const rowRef = rowsState.innerBlockRefs[rowIdx];
		const subPos = rowRef?.getCursorPosition?.();
		if (subPos) return { path: [rowIdx, ...subPos.path], offset: subPos.offset };
		return { path: [rowIdx, colIdx], offset: 0 };
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

	function setRowRef(i: number, r: BlockComponent | undefined): void {
		rowsState.innerBlockRefs[i] = r;
	}
	function getRowRef(i: number): BlockComponent | undefined {
		return rowsState.innerBlockRefs[i];
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
			alignments={meta?.alignments ?? []}
			myPath={[...myPath, rowIdx]}
			setRef={setRowRef}
			getRef={getRowRef}
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
