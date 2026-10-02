<script lang="ts">
	import { getContext } from 'svelte';
	import type { TableContext } from '../../../action-contracts';
	import { entryEdge, type BlockComponent } from '../../../block-component';
	import type { NodeView } from '../../../core/node-views';
	import {
		EDITOR_SERVICES_KEY,
		TABLE_CONTEXT_KEY,
		type EditorServices
	} from '../../../editor-keys';
	import type { TableAlignment } from '../../../core/nodes';
	import { useMountGauge } from '../../../perf/use-mount-gauge.svelte';
	import { useMeasuredChild } from '../../../reactivity/use-measured-child.svelte';
	import { createContainerActions } from '../../../editor-actions/nested/container-actions';
	import { publishRefSlot, type RefSlots } from '../../../reactivity/publish-ref.svelte';
	import type { ChildList } from '../../../reactivity/child-list';
	import { useBlockDecorations } from '../../../decorations/use-block-decorations.svelte';
	import TableCellBlock from './TableCellBlock.svelte';

	let {
		node,
		index,
		id,
		columnCount,
		rowCount,
		alignments = [],
		myPath = [],
		slots
	}: {
		node: NodeView;
		index: number;
		id: string;
		columnCount: number;
		rowCount: number;
		alignments?: readonly TableAlignment[];
		myPath?: number[];
		slots?: RefSlots<BlockComponent>;
	} = $props();

	// A row's position among the table's children is its row index.
	const rowIdx = $derived(index);

	const { decorations, events } = getContext<EditorServices>(EDITOR_SERVICES_KEY);

	const { state: cellsState } = createContainerActions({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		childList: () => cellList
	});

	let rowEl: HTMLElement | undefined = $state();
	// Absent only when a row mounts outside a table, as a unit test's might.
	const tableContext = getContext<TableContext | undefined>(TABLE_CONTEXT_KEY);

	useMountGauge();

	// The row renders no block host, so its own element carries the decorations addressed to it.
	const blockDecorations = useBlockDecorations({
		getPath: () => myPath,
		getEl: () => rowEl ?? null,
		engine: decorations,
		onRenderError: (error) => events.emit('error', error),
		badgeRefusal: 'a table row renders no box of its own to hold one'
	});

	// A `display: contents` row has no box, so its first cell, stretched to the row track, gives
	// the row's height. Read through the first cell's id, so a moved first column is watched anew.
	useMeasuredChild({
		getId: () => id,
		getPath: () => myPath,
		getEl: () => {
			void cellsState.innerBlockIds[0];
			return rowEl?.querySelector<HTMLElement>(':scope > .table-cell') ?? null;
		},
		getRaw: () => node.raw
	});

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	function entryCell(offset: number): { colIdx: number; at: number } {
		const edge = entryEdge(offset);
		return { colIdx: edge.child === 'first' ? 0 : columnCount - 1, at: edge.offset };
	}

	export function focus(offset: number): void {
		const { colIdx, at } = entryCell(offset);
		cellsState.innerBlockRefs[colIdx]?.focus(at);
	}

	export function parkCaret(offset: number): void {
		const { colIdx, at } = entryCell(offset);
		cellsState.innerBlockRefs[colIdx]?.parkCaret?.(at);
	}

	export function getCursorOffset(): number | null {
		return null;
	}

	export function focusByPath(path: number[], offset: number): void {
		const [colIdx, ...rest] = path;
		const cellRef = cellsState.innerBlockRefs[colIdx];
		cellRef?.focus(rest.length === 0 ? offset : 0);
	}

	// Cells aren't windowed, so a mounted row has every cell in range; the grid's own sideways
	// scroll is what brings a far column into view.
	const cellList: ChildList = {
		count: () => node.children?.length ?? 0,
		refs: cellsState.refSlots,
		windowing: { revealChild: async () => {}, isInWindow: () => true },
		bringChildIntoView: (colIdx) => tableContext?.revealColumn(rowIdx, colIdx)
	};

	function childList(): ChildList {
		return cellList;
	}

	export function getCursorPosition(): { path: number[]; offset: number } | null {
		for (let colIdx = 0; colIdx < cellsState.innerBlockRefs.length; colIdx++) {
			const cellRef = cellsState.innerBlockRefs[colIdx];
			const offset = cellRef?.getCursorOffset();
			if (offset !== null && offset !== undefined) return { path: [colIdx], offset };
		}
		return null;
	}

	// The one place this shape is written, as in the cell: a row reaches every caller through
	// its registered reference, so a second copy to type-check against would mislead.
	$effect(() => {
		if (!slots) return;
		const self = {
			editable,
			focusable,
			focus,
			parkCaret,
			getCursorOffset,
			getCursorPosition,
			focusByPath,
			childList
		} satisfies BlockComponent;
		return publishRefSlot(slots, index, self, rowEl);
	});
</script>

<!-- No whitespace between the row and its cells: a stray text node joins the table's
	raw-offset traversal and misplaces a remembered cross-block caret. -->
<div
	bind:this={rowEl}
	class={['table-row', ...blockDecorations.classes]}
	role="row"
	data-table-row-idx={rowIdx}
>
	{#each node.children ?? [] as cellNode, colIdx (cellsState.innerBlockIds[colIdx])}
		<TableCellBlock
			node={cellNode}
			index={colIdx}
			myPath={[...myPath, colIdx]}
			{rowIdx}
			{columnCount}
			{rowCount}
			alignment={alignments[colIdx] ?? 'none'}
			slots={cellsState.refSlots}
		/>
	{/each}
</div>

<style>
	.table-row {
		display: contents;
	}
</style>
