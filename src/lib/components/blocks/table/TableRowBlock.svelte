<script lang="ts">
	import { getContext } from 'svelte';
	import type {
		BlockEditActions,
		ContainerEditActions,
		FocusActions
	} from '../../../action-contracts';
	import type { BlockComponent } from '../../../block-component';
	import type { NodeView } from '../../../core/node-views';
	import {
		BLOCK_EDIT_KEY,
		CONTAINER_EDIT_KEY,
		EDITOR_SERVICES_KEY,
		FOCUS_KEY,
		PARENT_SCOPE_SINK_KEY,
		type EditorServices,
		type ParentScopeSink
	} from '../../../editor-keys';
	import type { TableAlignment } from '../../../core/nodes';
	import { createBlockListState } from '../../../reactivity/block-list-state.svelte';
	import { useMountGauge } from '../../../perf/use-mount-gauge.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts,
		type NodeScope
	} from '../../../editor-actions/nested/nested-actions';
	import { publishRefSlot } from '../../../reactivity/publish-ref.svelte';
	import TableCellBlock from './TableCellBlock.svelte';
	import TableGrip from './TableGrip.svelte';

	let {
		node,
		index,
		id,
		rowIdx,
		columnCount,
		rowCount,
		alignments = [],
		myPath = [],
		setRef,
		getRef,
		onOpenRowMenu,
		onRowGripPointerDown
	}: {
		node: NodeView;
		index: number;
		id: string;
		rowIdx: number;
		columnCount: number;
		rowCount: number;
		alignments?: readonly TableAlignment[];
		myPath?: number[];
		setRef?: (i: number, r: BlockComponent | undefined) => void;
		getRef?: (i: number) => BlockComponent | undefined;
		onOpenRowMenu?: (rowIdx: number, e: MouseEvent) => void;
		onRowGripPointerDown?: (rowIdx: number, e: PointerEvent) => void;
	} = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const { stickyColumn, registryView } = getContext<EditorServices>(EDITOR_SERVICES_KEY);

	const cellsState = createBlockListState(() => node);

	let rowEl: HTMLElement | undefined = $state();
	const parentSink = getContext<ParentScopeSink | undefined>(PARENT_SCOPE_SINK_KEY);

	useMountGauge();

	// A `display: contents` row has no box, so measure a cell: every cell stretches
	// to the grid row track (no grid gap), so a cell's border-box height is the row
	// height. Enroll in the table scope's batched pass (mirrors BlockHost) so a fling
	// over a giant table reads every mounted row before writing any subtotal — one
	// reflow, not one per row. Re-registers on index change; re-measures on edit.
	$effect(() => {
		void index;
		if (!parentSink) return;
		const currentIndex = index;
		return parentSink.registerRow(
			id,
			() => {
				const cell = rowEl?.querySelector(':scope > .table-cell') as HTMLElement | null;
				return cell?.getBoundingClientRect().height ?? 0;
			},
			(h) => parentSink.setChildSubtotal(currentIndex, h)
		);
	});

	// Skip the mount run (mirrors BlockHost): on a fling many rows mount in one frame,
	// and a per-row read here interleaved with the prior row's subtotal write forces one
	// reflow per mounted row (VR-4). The table scope's batched pass owns mount
	// measurement (the `registerRow` effect above enrolled this row); this effect
	// re-measures only on a subsequent real edit.
	let firstRun = true;
	$effect(() => {
		void node.raw;
		if (firstRun) {
			firstRun = false;
			return;
		}
		parentSink?.measureRowNow(id);
	});

	const scope: NodeScope = {
		get index() {
			return index;
		},
		get node() {
			return node;
		},
		get path() {
			return myPath;
		}
	};

	const bundle = createStandardNestedActions(cellsState, {
		scope,
		stickyColumn,
		grammar: registryView.grammar,
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

	export function getBlockComponentByPath(path: number[]): BlockComponent | null {
		if (path.length === 0) return null;
		const [colIdx, ...rest] = path;
		const cellRef = cellsState.innerBlockRefs[colIdx];
		if (!cellRef) return null;
		if (rest.length === 0) return cellRef;
		return cellRef.getBlockComponentByPath?.(rest) ?? null;
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
		focusByPath,
		getBlockComponentByPath
	} satisfies BlockComponent);

	$effect(() => {
		if (!setRef || !getRef) return;
		const self: BlockComponent = {
			editable,
			focusable,
			focus,
			getCursorOffset,
			getCursorPosition,
			focusByPath,
			getBlockComponentByPath
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

<!-- The grip is the row's first child so it lands in the table's zero-width gutter
	track (col 1) and the cells fill cols 2..N+1; its dots overflow right into cell A's
	left padding. No whitespace between it and the cells: a stray text node here joins
	the table's raw-offset walk and misplaces a parked cross-block caret. -->
<div bind:this={rowEl} class="table-row" role="row" data-table-row-idx={rowIdx}>
	<TableGrip
		axis="row"
		onActivate={(e) => onOpenRowMenu?.(rowIdx, e)}
		onpointerdown={(e) => onRowGripPointerDown?.(rowIdx, e)}
	/>{#each node.children ?? [] as cellNode, colIdx (cellsState.innerBlockIds[colIdx])}
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
