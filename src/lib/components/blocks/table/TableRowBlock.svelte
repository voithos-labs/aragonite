<script lang="ts">
	import { getContext } from 'svelte';
	import type {
		BlockEditActions,
		ContainerEditActions,
		FocusActions
	} from '../../../action-contracts';
	import { CURSOR_END, CURSOR_START, type BlockComponent } from '../../../block-component';
	import type { NodeView } from '../../../core/node-views';
	import {
		BLOCK_EDIT_KEY,
		CONTAINER_EDIT_KEY,
		EDITOR_DOC_KEY,
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		FOCUS_KEY,
		PARENT_SCOPE_SINK_KEY,
		type EditorDoc,
		type EditorPolicies,
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
	import { publishRefSlot, type RefSlots } from '../../../reactivity/publish-ref.svelte';
	import TableCellBlock from './TableCellBlock.svelte';
	import TableGrip from './TableGrip.svelte';

	let {
		node,
		index,
		id,
		columnCount,
		rowCount,
		alignments = [],
		myPath = [],
		slots,
		onOpenRowMenu,
		onRowGripPointerDown,
		showGrips
	}: {
		node: NodeView;
		index: number;
		id: string;
		columnCount: number;
		rowCount: number;
		alignments?: readonly TableAlignment[];
		myPath?: number[];
		slots?: RefSlots<BlockComponent>;
		onOpenRowMenu?: (rowIdx: number, e: MouseEvent) => void;
		onRowGripPointerDown?: (rowIdx: number, e: PointerEvent) => void;
		/** The table's `blockDragHandles` read, passed down rather than re-read: the row grip
		 *  and the gutter track it fills are one decision. */
		showGrips: boolean;
	} = $props();

	// A row's position among the table's children IS its row index.
	const rowIdx = $derived(index);

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const { stickyColumn, registryView } = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const getPresentationMode = getContext<EditorPolicies | undefined>(
		EDITOR_POLICIES_KEY
	)?.presentationMode;
	const linkRef = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY)?.linkRef;

	const cellsState = createBlockListState(() => node);

	let rowEl: HTMLElement | undefined = $state();
	const parentSink = getContext<ParentScopeSink | undefined>(PARENT_SCOPE_SINK_KEY);

	useMountGauge();

	// A `display: contents` row has no box, so measure a cell: every cell stretches to
	// the grid row track, making its border-box height the row height. Enrolling in the
	// table scope's batched pass keeps a fling to one reflow, not one per mounted row.
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

	// Skip the mount run (mirrors BlockHost): a read here interleaved with the prior row's
	// subtotal write forces one reflow per row mounted in the frame (VR-4). The batched
	// pass owns mount measurement; this effect re-measures only on a later edit.
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
		getPresentationMode,
		linkRef,
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

	// The TableBlock twin's rule: a start arrival enters the first cell, anything else the
	// last, and the sentinel rides into the cell so its door clamps and classifies.
	function rowLanding(offset: number): { colIdx: number; at: number } {
		const atStart = offset === 0 || offset === CURSOR_START;
		return atStart ? { colIdx: 0, at: CURSOR_START } : { colIdx: columnCount - 1, at: CURSOR_END };
	}

	export function focus(offset: number): void {
		const { colIdx, at } = rowLanding(offset);
		cellsState.innerBlockRefs[colIdx]?.focus(at);
	}

	export function parkCaret(offset: number): void {
		const { colIdx, at } = rowLanding(offset);
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

	// The ONE surface literal, the cell's twin: a row reaches every caller through its published
	// slot, so a second literal to type-check against would only be a decoy.
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
			getBlockComponentByPath
		} satisfies BlockComponent;
		return publishRefSlot(slots, index, self, rowEl);
	});
</script>

<!-- The grip is the row's first child so it lands in the table's zero-width gutter track
	and the cells fill the rest. No whitespace between it and the cells: a stray text node
	joins the table's raw-offset walk and misplaces a parked cross-block caret. -->
<div bind:this={rowEl} class="table-row" role="row" data-table-row-idx={rowIdx}>
	{#if showGrips}<TableGrip
			axis="row"
			onActivate={(e) => onOpenRowMenu?.(rowIdx, e)}
			onpointerdown={(e) => onRowGripPointerDown?.(rowIdx, e)}
		/>{/if}{#each node.children ?? [] as cellNode, colIdx (cellsState.innerBlockIds[colIdx])}
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
