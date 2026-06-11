<script lang="ts">
	import { setContext, getContext } from 'svelte';
	import type {
		BlockEditActions,
		CellPosition,
		ContainerEditActions,
		FocusActions,
		TableContext
	} from '../../../action-contracts';
	import {
		SELECTION_END,
		type BlockComponent,
		type StickyColumnDirection
	} from '../../../block-component';
	import type { CstNode } from '../../../core/nodes';
	import {
		BLOCK_EDIT_KEY,
		CONTAINER_EDIT_KEY,
		CONTROLLER_KEY,
		EDITOR_ROOT_KEY,
		FOCUS_KEY,
		SELECTION_KEY,
		STICKY_COLUMN_KEY,
		TABLE_CONTEXT_KEY
	} from '../../../editor-keys';
	import { metadataOf } from '../../../core/nodes';
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
	const getEditorRoot = getContext<() => HTMLElement | null>(EDITOR_ROOT_KEY);

	const meta = $derived(metadataOf(node, 'table'));
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
		get path() {
			return myPath;
		},
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

	// 2D surface — one integer can't address a cell. Callers that need a
	// specific cell use the deep `focusByPath`; this mirrors
	// `createContainerBlockComponent.focus`'s 0-or-last collapse.
	export function focus(offset: number): void {
		if (rowCount === 0) return;
		if (offset === 0) {
			focusCell(0, 0, 'start');
			return;
		}
		focusCell(rowCount - 1, columnCount - 1, 'end');
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

	// See `focus()` — 2D surface, no shallow offset. Cursor location comes
	// from `getCursorPosition` below, which selection consumers prefer.
	export function getCursorOffset(): number | null {
		return null;
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
			selection?.isCustomRendered && !!anchor && !!focus && pathsEqual(anchor.path, focus.path);

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
		const editorRoot = getEditorRoot();
		if (!editorRoot) return [];
		// Editor-relative space matches the captured sticky X (which is also
		// editor-relative). cell.getBoundingClientRect() already accounts for
		// the table's internal scroll position.
		const editorLeft = editorRoot.getBoundingClientRect().left;
		const cells = Array.from(firstRowEl.querySelectorAll(':scope > .table-cell'));
		return cells.map((c) => {
			const r = (c as HTMLElement).getBoundingClientRect();
			return { left: r.left - editorLeft, right: r.right - editorLeft };
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
	style:grid-template-columns={`repeat(${columnCount}, minmax(80px, max-content))`}
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
		width: max-content;
		max-width: 100%;
		overflow-x: auto;
		/* Modern standard — Edge/Chrome 121+ and Firefox honor these. */
		scrollbar-width: thin;
		scrollbar-color: var(--color-ui-muted, #444) transparent;
	}
	/* Webkit fallback for older Chromium. */
	.table-block::-webkit-scrollbar {
		height: 6px;
	}
	.table-block::-webkit-scrollbar-track {
		background: transparent;
	}
	.table-block::-webkit-scrollbar-thumb {
		background: var(--color-ui-muted, #444);
		border-radius: 3px;
	}
	.table-block::-webkit-scrollbar-thumb:hover {
		background: var(--color-ui-dulled, #666);
	}
</style>
