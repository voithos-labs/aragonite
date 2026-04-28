<script lang="ts">
	import { getContext } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		FOCUS_KEY,
		CONTAINER_EDIT_KEY,
		STICKY_COLUMN_KEY,
		type BlockEditActions,
		type FocusActions,
		type ContainerEditActions,
		type CstNode,
		type BlockComponent
	} from '../../../contracts';
	import type { TableAlignment } from '../../../core/nodes';
	import type { StickyColumnState } from '../../../cursor/sticky-column';
	import { createBlockListState } from '../../../reactivity/block-list-state.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from '../../../editor-actions/nested-actions';
	import { rebuildContainerRaw } from '../../../schema/container-raw';
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

	const state = createBlockListState(() => node);

	const bundle = createStandardNestedActions(state, {
		get index() {
			return index;
		},
		get node() {
			return node;
		},
		rebuildRaw: () => rebuildContainerRaw(node),
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
		state.innerBlockRefs[0]?.focus(0);
	}

	export function getCursorOffset(): number | null {
		return null;
	}

	export function focusByPath(path: number[], offset: number): void {
		const [colIdx, ...rest] = path;
		const cellRef = state.innerBlockRefs[colIdx];
		cellRef?.focus(rest.length === 0 ? offset : 0);
	}

	export function getCursorPosition(): { path: number[]; offset: number } | null {
		for (let colIdx = 0; colIdx < state.innerBlockRefs.length; colIdx++) {
			const cellRef = state.innerBlockRefs[colIdx];
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
		state.innerBlockRefs[i] = r;
	}
	function getCellRef(i: number): BlockComponent | undefined {
		return state.innerBlockRefs[i];
	}
</script>

<div class="table-row" role="row" data-table-row-idx={rowIdx}>
	{#each node.children ?? [] as cellNode, colIdx (state.innerBlockIds[colIdx])}
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
