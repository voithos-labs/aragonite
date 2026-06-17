<script lang="ts">
	import { getContext } from 'svelte';
	import type {
		BlockEditActions,
		ContainerEditActions,
		FocusActions
	} from '../../../action-contracts';
	import type { BlockComponent } from '../../../block-component';
	import type { CstNode } from '../../../core/nodes';
	import {
		BLOCK_EDIT_KEY,
		CONTAINER_EDIT_KEY,
		FOCUS_KEY,
		PARENT_SCOPE_SINK_KEY,
		STICKY_COLUMN_KEY,
		type ParentScopeSink
	} from '../../../editor-keys';
	import type { TableAlignment } from '../../../core/nodes';
	import type { StickyColumnState } from '../../../cursor/sticky-column';
	import { createBlockListState } from '../../../reactivity/block-list-state.svelte';
	import { incMountedBlocks, decMountedBlocks, perfEnabled } from '../../../perf/instruments';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from '../../../editor-actions/nested-actions';
	import { publishRefSlot } from '../../../reactivity/publish-ref.svelte';
	import TableCellBlock from './TableCellBlock.svelte';

	let {
		node,
		index,
		rowIdx,
		columnCount,
		rowCount,
		alignments = [],
		myPath = [],
		setRef,
		getRef
	}: {
		node: CstNode;
		index: number;
		rowIdx: number;
		columnCount: number;
		rowCount: number;
		alignments?: readonly TableAlignment[];
		myPath?: number[];
		setRef?: (i: number, r: BlockComponent | undefined) => void;
		getRef?: (i: number) => BlockComponent | undefined;
	} = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);

	const cellsState = createBlockListState(() => node);

	let rowEl: HTMLElement | undefined = $state();
	const parentSink = getContext<ParentScopeSink | undefined>(PARENT_SCOPE_SINK_KEY);

	// Rows aren't BlockHosts, so count this row in the mount gauge directly
	// (mirrors ListItemBlock) — otherwise a windowed giant table reads as ~0
	// mounted blocks.
	$effect(() => {
		if (perfEnabled()) incMountedBlocks();
		return () => {
			if (perfEnabled()) decMountedBlocks();
		};
	});

	// A `display: contents` row has no box, so measure a cell: every cell stretches
	// to the grid row track (no grid gap), so a cell's border-box height is the row
	// height. `void node.raw` re-measures when this row's cell content changes.
	$effect(() => {
		void node.raw;
		if (!parentSink || !rowEl) return;
		const cell = rowEl.querySelector(':scope > .table-cell') as HTMLElement | null;
		const h = cell?.getBoundingClientRect().height ?? 0;
		if (h > 0) parentSink.setChildSubtotal(index, h);
	});

	const bundle = createStandardNestedActions(cellsState, {
		get index() {
			return index;
		},
		get node() {
			return node;
		},
		get path() {
			return myPath;
		},
		stickyColumn,
		parent: {
			blockEdit: parentBlockEdit,
			focus: parentFocus,
			containerEdit: parentContainerEdit
		}
	});

	setNestedActionsContexts(bundle);

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export function focus(_offset: number): void {
		cellsState.innerBlockRefs[0]?.focus(0);
	}

	export function getCursorOffset(): number | null {
		return null;
	}

	export function focusByPath(path: number[], offset: number): void {
		const [colIdx, ...rest] = path;
		const cellRef = cellsState.innerBlockRefs[colIdx];
		cellRef?.focus(rest.length === 0 ? offset : 0);
	}

	export function getCursorPosition(): { path: number[]; offset: number } | null {
		for (let colIdx = 0; colIdx < cellsState.innerBlockRefs.length; colIdx++) {
			const cellRef = cellsState.innerBlockRefs[colIdx];
			const offset = cellRef?.getCursorOffset();
			if (offset !== null && offset !== undefined) return { path: [colIdx], offset };
		}
		return null;
	}

	void ({
		editable,
		focusable,
		focus,
		getCursorOffset,
		getCursorPosition,
		focusByPath
	} satisfies BlockComponent);

	$effect(() => {
		if (!setRef || !getRef) return;
		const self: BlockComponent = {
			editable,
			focusable,
			focus,
			getCursorOffset,
			getCursorPosition,
			focusByPath
		};
		return publishRefSlot(index, self, setRef, getRef);
	});

	function setCellRef(i: number, r: BlockComponent | undefined): void {
		cellsState.innerBlockRefs[i] = r;
	}
	function getCellRef(i: number): BlockComponent | undefined {
		return cellsState.innerBlockRefs[i];
	}
</script>

<div bind:this={rowEl} class="table-row" role="row" data-table-row-idx={rowIdx}>
	{#each node.children ?? [] as cellNode, colIdx (cellsState.innerBlockIds[colIdx])}
		<TableCellBlock
			node={cellNode}
			index={colIdx}
			myPath={[...myPath, colIdx]}
			{rowIdx}
			{colIdx}
			{columnCount}
			{rowCount}
			alignment={alignments[colIdx] ?? 'none'}
			setRef={setCellRef}
			getRef={getCellRef}
		/>
	{/each}
</div>

<style>
	.table-row {
		display: contents;
	}
</style>
