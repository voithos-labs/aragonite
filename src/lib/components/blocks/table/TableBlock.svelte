<script lang="ts">
	import { setContext, getContext } from 'svelte';
	import {
		FOCUS_KEY,
		STICKY_COLUMN_KEY,
		TABLE_CONTEXT_KEY,
		type CstNode,
		type FocusActions,
		type BlockComponent,
		type StickyColumnDirection,
		type TableContext,
		type CellPosition
	} from '../../../contracts';
	import type { TableMetadata } from '../../../core/nodes';
	import type { StickyColumnState } from '../../../cursor/sticky-column';
	import { columnNearestX } from './cell-x-mapping';
	import { createBlockListState } from '../../../reactivity/block-list-state.svelte';
	import TableRowBlock from './TableRowBlock.svelte';

	let {
		node,
		myPath
	}: {
		node: CstNode;
		index: number;
		myPath: number[];
	} = $props();

	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const editorStickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);

	const meta = $derived(node.metadata as TableMetadata | undefined);
	const rowCount = $derived(node.children?.length ?? 0);
	const columnCount = $derived(meta?.columnCount ?? 1);

	let internalStickyColumn: number | null = $state(null);
	let focusedCell: { rowIdx: number; colIdx: number } | null = $state(null);
	let tableEl: HTMLDivElement | undefined = $state();

	const rowsState = createBlockListState(() => node);

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
		// Mutation methods are wired into the context for visibility but unimplemented.
		// Throwing keeps accidental callers loud.
		insertRowAbove: async () => {
			throw new Error('insertRowAbove: not yet implemented');
		},
		insertRowBelow: async () => {
			throw new Error('insertRowBelow: not yet implemented');
		},
		insertColumnLeft: async () => {
			throw new Error('insertColumnLeft: not yet implemented');
		},
		insertColumnRight: async () => {
			throw new Error('insertColumnRight: not yet implemented');
		},
		deleteRow: async () => {
			throw new Error('deleteRow: not yet implemented');
		},
		deleteColumn: async () => {
			throw new Error('deleteColumn: not yet implemented');
		},
		cycleAlignment: async () => {
			throw new Error('cycleAlignment: not yet implemented');
		}
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

	// Returns direct cellIdx (NOT cellIdx+1). The half-open `+1` for cross-block
	// range inclusion lives in cross-block transition logic, not here.
	export function getCursorOffset(): number | null {
		if (!focusedCell) return null;
		return focusedCell.rowIdx * columnCount + focusedCell.colIdx;
	}

	export function getCursorPosition(): { path: number[]; offset: number } | null {
		if (!focusedCell) return null;
		// Path is { rowIdx, colIdx }; within-cell offset is not surfaced and is
		// intentionally 0, so undo restoration lands at cell start of the focused
		// cell. Refine when intra-cell precision is needed.
		return { path: [focusedCell.rowIdx, focusedCell.colIdx], offset: 0 };
	}

	// Cross-block selection painting is not wired up; return [] to keep callers safe.
	export function measurePartialRects(_start: number, _end: number): DOMRect[] {
		return [];
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
