<script lang="ts">
	import { setContext, getContext, untrack, tick } from 'svelte';
	import type {
		BlockEditActions,
		CellPosition,
		ContainerEditActions,
		FocusActions,
		TableAxisAction,
		TableContext
	} from '../../../action-contracts';
	import {
		CURSOR_END,
		type BlockComponent,
		type StickyColumnDirection
	} from '../../../block-component';
	import type { NodeView } from '../../../core/node-views';
	import {
		BLOCK_EDIT_KEY,
		CONTAINER_EDIT_KEY,
		EDITOR_DOC_KEY,
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		FOCUS_KEY,
		TABLE_CONTEXT_KEY,
		type EditorDoc,
		type EditorPolicies,
		type EditorServices
	} from '../../../editor-keys';
	import { metadataOf } from '../../../core/nodes';
	import { asEditorX } from '../../../cursor/coordinate-spaces';
	import { pathsEqual } from '../../../selection/path-math';
	import { placeCaret } from '../../../selection/caret-doors';
	import { columnNearestX } from './cell-x-mapping';
	import { cellAtPoint, mountedRowEls, rowCellEls } from './cell-pointer';
	import { intraTableRect } from './cell-clipboard';
	import { selectedCells } from './selected-cells';
	import { createBlockListState } from '../../../reactivity/block-list-state.svelte';
	import { useContainerWindowing } from '../../../reactivity/use-container-windowing.svelte';
	import { sliceWindow } from '../../../reactivity/window-slice';
	import { revealChildOrWait } from '../../../reactivity/publish-ref.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts,
		type NodeScope
	} from '../../../editor-actions/nested/nested-actions';
	import { createTableMutationsContext } from '../../../editor-actions/table-context';
	import {
		startRowReorderDrag,
		startColumnReorderDrag,
		type RowReorderLine,
		type ColumnReorderLine
	} from './table-reorder-drag';
	import TableRowBlock from './TableRowBlock.svelte';
	import TableGrip from './TableGrip.svelte';
	import TableActionMenu from './TableActionMenu.svelte';
	import { tableMenuItems, type ClipboardAction } from './table-menu-model';

	let {
		node,
		index,
		myPath
	}: {
		node: NodeView;
		index: number;
		myPath: number[];
	} = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const {
		controller,
		stickyColumn: editorStickyColumn,
		selection,
		reorderAnnounce: announceReorder,
		registryView
	} = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const {
		editorRoot: getEditorRoot,
		scrollHost: getScrollHost,
		widthVersion: getWidthVersion,
		lifetime: editorLifetime
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const getPresentationMode = getContext<EditorPolicies | undefined>(
		EDITOR_POLICIES_KEY
	)?.presentationMode;
	// Every menu item mutates the table, so reading mode declines to open it and the
	// native context menu (with Copy) shows instead.
	const readOnly = $derived(getPresentationMode?.() === 'reading');

	const meta = $derived(metadataOf(node, 'table'));
	const rowCount = $derived(node.children?.length ?? 0);
	const columnCount = $derived(meta.columnCount);

	// A column reorder permutes cells while leaving columnCount and widthVersion untouched,
	// so it alone can't invalidate the monotonic width floors below; the header row's
	// cell-id order tracks column order and nothing else, so the measure epoch folds it in.
	const columnStructureToken = $derived((node.children?.[0]?.childIds ?? []).join(','));

	// Plain `let`, not $state: writes happen during keyed-each reconcile via
	// the focusout handler, which Svelte 5 traps as state_unsafe_mutation.
	let internalStickyColumn: number | null = null;
	let focusedCell: { rowIdx: number; colIdx: number } | null = null;
	let tableEl: HTMLDivElement | undefined = $state();

	const rowsState = createBlockListState(() => node);

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

	const bundle = createStandardNestedActions(rowsState, {
		scope,
		stickyColumn: editorStickyColumn,
		grammar: registryView.grammar,
		parent: {
			blockEdit: parentBlockEdit,
			focus: focusActions,
			containerEdit: parentContainerEdit
		}
	});

	setNestedActionsContexts(bundle);

	// ── Virtual rendering (row windowing) ───────────────────────────────

	const windowing = useContainerWindowing({
		getIndex: () => index,
		getParentPath: () => myPath,
		getChildren: () => node.children ?? [],
		getChildIds: () => rowsState.innerBlockIds,
		// The .table-block grid IS the content origin (holds spacers + rows).
		getListEl: () => tableEl ?? null,
		// The table is itself a BlockHost block; match the leaf channel the parent measured
		// for it, so the subtotal reported up doesn't fight that slot.
		getOwnEl: () => tableEl?.closest('.block-host') ?? null,
		provideLeafChannel: false
	});

	let win = $derived(windowing.window);
	let bounds = $derived(sliceWindow((node.children ?? []).length, win));

	// Pin each column track to the widest cell SEEN across all windowed-in rows: a bare
	// `minmax(80px, max-content)` sizes to the mounted cells, so a column jumps width as a
	// wide cell scrolls out of the mounted set (F6). The floor only ever grows.
	let columnMaxWidths = $state<number[]>([]);

	// Leading `0` track is the row-grip gutter: zero width keeps cell A's left edge at the
	// same x, so caret pixel-measurement and sticky-column geometry are untouched.
	const trackTemplate = $derived(
		[
			'0',
			...Array.from({ length: columnCount }, (_, c) => {
				const floor = Math.max(80, columnMaxWidths[c] ?? 0);
				return `minmax(${floor}px, max-content)`;
			})
		].join(' ')
	);

	let measuredColumnEpoch = '';

	// An epoch change resets the cache first: the old maxes are stale, and monotonic-grow
	// would otherwise pin a track too wide. Within a stable epoch the floor only grows and
	// only bumps state on an increase, so the effect settles rather than spinning.
	$effect(() => {
		void win;
		const epoch = `${columnCount}:${getWidthVersion?.() ?? 0}:${columnStructureToken}`;
		untrack(() => {
			if (epoch !== measuredColumnEpoch) {
				measuredColumnEpoch = epoch;
				columnMaxWidths = [];
			}
			growColumnFloors();
		});
	});

	function growColumnFloors(): void {
		if (!tableEl || columnCount === 0) return;
		const next = columnMaxWidths.slice();
		let grew = false;
		for (const rowEl of mountedRowEls(tableEl)) {
			const cells = rowCellEls(rowEl);
			for (let c = 0; c < cells.length && c < columnCount; c++) {
				const width = cells[c].getBoundingClientRect().width;
				if (width > (next[c] ?? 0)) {
					next[c] = width;
					grew = true;
				}
			}
		}
		if (grew) columnMaxWidths = next;
	}

	// ── Table context (cell coordination) ──────────────────────────────────

	function rowRefAt(rowIdx: number): BlockComponent | undefined {
		return rowsState.innerBlockRefs[rowIdx];
	}

	function offsetForPosition(position: CellPosition): number {
		if (position === 'start') return 0;
		if (position === 'end') return CURSOR_END;
		return position;
	}

	function focusCell(rowIdx: number, colIdx: number, position: CellPosition): void {
		rowRefAt(rowIdx)?.focusByPath?.([colIdx], offsetForPosition(position));
	}

	const mutations = createTableMutationsContext({
		get node() {
			return node;
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
		focusCell,
		announceReorder
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
			editorStickyColumn.capture(asEditorX(stickyX));
			internalStickyColumn = null;
			focusActions.moveFocus(myPath[myPath.length - 1] - 1, {
				stickyColumnFrom: 'below'
			});
		},
		exitDownward(stickyX) {
			editorStickyColumn.capture(asEditorX(stickyX));
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

	// ── Affordance menu (row + column) ─────────────────────────────────────

	const columnIndices = $derived(Array.from({ length: columnCount }, (_, c) => c));

	type MenuAxis = 'row' | 'column';
	type MenuTarget = { rowIdx?: number; colIdx?: number };
	// clipboardSel is the cell's selection captured at right-click, before the menu steals
	// focus — null for grip menus and for an empty cell with no caret.
	type CellSelection = { start: number; end: number };
	let menu = $state<{
		target: MenuTarget;
		x: number;
		y: number;
		clipboardSel: CellSelection | null;
	} | null>(null);

	// A live rectangle suppresses the cell-local selection, so the menu reads it
	// separately to keep Cut/Copy enabled.
	const rectActive = $derived.by(() => {
		if (!selection) return false;
		const rect = intraTableRect(selection);
		return rect !== null && pathsEqual(rect.tablePath, myPath);
	});

	const menuItems = $derived(
		menu
			? tableMenuItems(menu.target, { rowCount, colCount: columnCount }, meta.alignments ?? [], {
					hasSelection: !!menu.clipboardSel && menu.clipboardSel.start !== menu.clipboardSel.end,
					hasRect: rectActive
				})
			: []
	);

	function openMenu(axis: MenuAxis, axisIdx: number, e: MouseEvent): void {
		const grip = e.currentTarget as HTMLElement | null;
		const rect = grip?.getBoundingClientRect();
		const target: MenuTarget = axis === 'column' ? { colIdx: axisIdx } : { rowIdx: axisIdx };
		if (!rect) {
			menu = { target, x: e.clientX, y: e.clientY, clipboardSel: null };
			return;
		}
		// A row grip opens beside itself rather than below, so the menu clears the left edge.
		menu =
			axis === 'column'
				? { target, x: rect.left, y: rect.bottom, clipboardSel: null }
				: { target, x: rect.right, y: rect.top, clipboardSel: null };
	}

	function cellRefAt(rowIdx: number, colIdx: number): BlockComponent | null {
		return rowRefAt(rowIdx)?.getBlockComponentByPath?.([colIdx]) ?? null;
	}

	// Capture the cell's selection now, before a menu-item click moves focus off it, so
	// Cut/Copy have a range to act on.
	function openMenuAtCell(rowIdx: number, colIdx: number, x: number, y: number): void {
		const clipboardSel = cellRefAt(rowIdx, colIdx)?.getSelectionOffsets?.() ?? null;
		menu = { target: { rowIdx, colIdx }, x, y, clipboardSel };
	}

	// preventDefault only over a cell, so a right-click in the table's padding gaps keeps
	// the native menu.
	function openCellMenu(e: MouseEvent): void {
		if (readOnly || !tableEl) return;
		const cell = cellAtPoint(e.clientX, e.clientY, tableEl);
		if (!cell) return;
		e.preventDefault();
		openMenuAtCell(cell.rowIdx, cell.colIdx, e.clientX, e.clientY);
	}

	// Keyboard equivalent of the cell right-click, bubbling up from the cell;
	// preventDefault suppresses the native context menu the key would trigger.
	function onTableKeyDown(e: KeyboardEvent): void {
		const opensMenu = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
		if (readOnly || !opensMenu || !focusedCell) return;
		e.preventDefault();
		const { rowIdx, colIdx } = focusedCell;
		const rect = cellElementAt(rowIdx, colIdx)?.getBoundingClientRect();
		openMenuAtCell(rowIdx, colIdx, rect ? rect.left : 0, rect ? rect.bottom : 0);
	}

	// Cell menus only — a grip menu has no caret to return to. The restore goes through
	// `focusCell`: a bare `el.focus()` on a contenteditable seats no typeable caret.
	async function closeMenuRestoringFocus(): Promise<void> {
		const target = menu?.target;
		const offset = menu?.clipboardSel?.start ?? 'start';
		menu = null;
		if (target?.rowIdx == null || target?.colIdx == null) return;
		await tick();
		focusCell(target.rowIdx, target.colIdx, offset);
	}

	async function runAction(action: TableAxisAction, axisIdx: number): Promise<void> {
		if (!menu) return;
		await ctx[action](axisIdx);
		menu = null;
	}

	async function runClipboard(action: ClipboardAction): Promise<void> {
		if (!menu) return;
		const { rowIdx, colIdx } = menu.target;
		const sel = menu.clipboardSel ?? { start: 0, end: 0 };
		menu = null;
		if (rowIdx == null || colIdx == null) return;
		await cellRefAt(rowIdx, colIdx)?.applyMenuClipboard?.(action, sel);
	}

	async function runAlign(alignment: 'left' | 'center' | 'right'): Promise<void> {
		const colIdx = menu?.target.colIdx;
		if (colIdx == null) return;
		await ctx.setColumnAlignment(colIdx, alignment);
		menu = null;
	}

	// ── Row drag reorder ───────────────────────────────────────────────────

	let dragLine = $state<RowReorderLine | null>(null);
	// A drag that ends off the grip fires no click, so this resets on every grip
	// pointerdown rather than being consumed on click; a stale `true` would eat a menu.
	let suppressRowGripClick = false;

	// Rows are `display: contents` (no box), so measure each mounted row's first cell.
	// Carries the ABSOLUTE row index so a drop maps a mounted edge to a body position
	// under windowing; re-read live each move, so an autoscroll re-slice is reflected.
	function rowReorderGeometry() {
		if (!tableEl || rowCount === 0) return null;
		const rowEdges: number[] = [];
		const gapIndices: number[] = [];
		let lastBottom = 0;
		let lastIdx = -1;
		for (const rowEl of mountedRowEls(tableEl)) {
			const cell = rowCellEls(rowEl)[0];
			if (!cell) continue;
			const rect = cell.getBoundingClientRect();
			const idx = Number(rowEl.getAttribute('data-table-row-idx'));
			rowEdges.push(rect.top);
			gapIndices.push(idx);
			lastBottom = rect.bottom;
			lastIdx = idx;
		}
		if (rowEdges.length === 0) return null;
		rowEdges.push(lastBottom);
		gapIndices.push(lastIdx + 1);
		const tableRect = tableEl.getBoundingClientRect();
		return { rowEdges, gapIndices, left: tableRect.left, width: tableRect.width };
	}

	function onRowGripPointerDown(rowIdx: number, e: PointerEvent): void {
		// Before any bail: a prior drag released off the grip left no click to consume it.
		suppressRowGripClick = false;
		// The header row is positionally fixed, so its grip stays click-only.
		if (rowIdx === 0) return;
		startRowReorderDrag(e, {
			fromRowIdx: rowIdx,
			getRowCount: () => rowCount,
			getGeometry: rowReorderGeometry,
			// Autoscroll must move whatever scrolls this editor — the root in self mode, the
			// host's scroller in host mode — or off-window rows never mount.
			getScrollContainer: getScrollHost,
			setLine: (line) => (dragLine = line),
			onDragRecognized: () => (suppressRowGripClick = true),
			commit: (from, to) => void mutations.reorderRowTo(from, to),
			lifetimeSignal: editorLifetime
		});
	}

	// ── Column drag reorder ─────────────────────────────────────────────────

	let columnDragLine = $state<ColumnReorderLine | null>(null);
	// Plain let, reset on every grip pointerdown — see suppressRowGripClick.
	let suppressColumnGripClick = false;

	// Columns aren't windowed, so any mounted row carries the shared track geometry.
	// Client coords match the position:fixed insertion line.
	function columnReorderGeometry() {
		if (!tableEl || rowCount === 0 || columnCount === 0) return null;
		const firstRowEl = mountedRowEls(tableEl)[0];
		if (!firstRowEl) return null;
		const cells = rowCellEls(firstRowEl);
		if (cells.length === 0) return null;
		const colEdges: number[] = [];
		for (const cell of cells) colEdges.push(cell.getBoundingClientRect().left);
		const lastCell = cells[cells.length - 1];
		colEdges.push(lastCell.getBoundingClientRect().right);
		const tableRect = tableEl.getBoundingClientRect();
		return { colEdges, top: tableRect.top, height: tableRect.height };
	}

	function onColumnGripPointerDown(colIdx: number, e: PointerEvent): void {
		// Before any bail: a prior drag released off the grip left no click to consume it.
		suppressColumnGripClick = false;
		startColumnReorderDrag(e, {
			fromColIdx: colIdx,
			getColCount: () => columnCount,
			getGeometry: columnReorderGeometry,
			// `.table-block` is itself the overflow-x container.
			getScrollContainer: () => tableEl ?? null,
			setLine: (line) => (columnDragLine = line),
			onDragRecognized: () => (suppressColumnGripClick = true),
			commit: (from, to) => void mutations.reorderColumnTo(from, to),
			lifetimeSignal: editorLifetime
		});
	}

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

	// 2D surface — one integer can't address a cell, so both caret doors mirror
	// `createContainerBlockComponent`'s 0-or-last collapse and cell callers use
	// `focusByPath`.
	export const focus = placeCaret(selection, (offset: number) => {
		if (rowCount === 0) return;
		if (offset === 0) {
			focusCell(0, 0, 'start');
			return;
		}
		focusCell(rowCount - 1, columnCount - 1, 'end');
	});

	export function parkCaret(offset: number): void {
		if (rowCount === 0) return;
		const atStart = offset === 0;
		const rowIdx = atStart ? 0 : rowCount - 1;
		const colIdx = atStart ? 0 : columnCount - 1;
		cellRefAt(rowIdx, colIdx)?.parkCaret?.(atStart ? 0 : CURSOR_END);
	}

	export function focusAtColumn(x: number, from: StickyColumnDirection): void {
		if (rowCount === 0) return;
		const targetRow = from === 'above' ? 0 : rowCount - 1;
		const colIdx = columnNearestX(asEditorX(x), collectColumnRects());
		internalStickyColumn = colIdx;
		focusCell(targetRow, colIdx, 'start');
	}

	export function focusByPath(path: number[], offset: number): void {
		const [rowIdx, colIdx, ...rest] = path;
		rowRefAt(rowIdx)?.focusByPath?.([colIdx, ...rest], offset);
	}

	export function getBlockComponentByPath(path: number[]): BlockComponent | null {
		if (path.length === 0) return null;
		const [rowIdx, ...rest] = path;
		const rowRef = rowsState.innerBlockRefs[rowIdx];
		if (!rowRef) return null;
		if (rest.length === 0) return rowRef;
		return rowRef.getBlockComponentByPath?.(rest) ?? null;
	}

	export async function revealByPath(path: number[]): Promise<BlockComponent | null> {
		if (path.length === 0) return null;
		const [rowIdx, ...rest] = path;
		// A row scrolled off-window can leave a detached ref in its slot, so the scroll gates
		// on live window bounds (a present ref is a cache, not a mount oracle) and drops it.
		await revealChildOrWait(rowIdx, {
			slots: rowsState.refSlots,
			childCount: rowCount,
			revealChild: windowing.revealChild,
			isStale: (i) => i < bounds.start || i >= bounds.end,
			isInWindow: windowing.isInWindow
		});
		const rowRef = rowsState.innerBlockRefs[rowIdx];
		if (!rowRef) return null;
		if (rest.length === 0) return rowRef;
		return rowRef.revealByPath
			? await rowRef.revealByPath(rest)
			: (rowRef.getBlockComponentByPath?.(rest) ?? null);
	}

	// See `focus()` — 2D surface, no shallow offset; `getCursorPosition` carries it.
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
		const cells = selectedCells({
			rect: selection ? intraTableRect(selection) : null,
			myPath,
			start,
			end,
			rowCount,
			columnCount
		});
		const rects: DOMRect[] = [];
		for (const { rowIdx, colIdx } of cells) {
			const cellEl = cellElementAt(rowIdx, colIdx);
			if (!cellEl) continue;
			rects.push(cellEl.getBoundingClientRect());
		}
		return rects;
	}

	export function cellRect(rowIdx: number, colIdx: number): DOMRect | null {
		const cellEl = cellElementAt(rowIdx, colIdx);
		return cellEl ? cellEl.getBoundingClientRect() : null;
	}

	export function mountedRowWindow(): { start: number; end: number } {
		return { start: win.start, end: win.end };
	}

	function cellElementAt(rowIdx: number, colIdx: number): HTMLElement | null {
		if (!tableEl) return null;
		if (rowIdx < 0 || rowIdx >= rowCount || colIdx < 0 || colIdx >= columnCount) return null;
		const rowEl = tableEl.querySelector(`:scope > [data-table-row-idx="${rowIdx}"]`);
		if (!rowEl) return null;
		return rowCellEls(rowEl)[colIdx] ?? null;
	}

	void ({
		editable,
		focusable,
		focus,
		parkCaret,
		focusAtColumn,
		focusByPath,
		getBlockComponentByPath,
		revealByPath,
		getCursorOffset,
		getCursorPosition,
		measurePartialRects,
		cellRect
	} satisfies BlockComponent);

	function collectColumnRects(): { left: number; right: number }[] {
		if (!tableEl || rowCount === 0) return [];
		const firstRowEl = mountedRowEls(tableEl)[0];
		if (!firstRowEl) return [];
		const editorRoot = getEditorRoot();
		if (!editorRoot) return [];
		// Editor-relative space, matching the captured sticky X.
		const editorLeft = editorRoot.getBoundingClientRect().left;
		return rowCellEls(firstRowEl).map((c) => {
			const r = c.getBoundingClientRect();
			return { left: r.left - editorLeft, right: r.right - editorLeft };
		});
	}
</script>

<!-- Delegated listeners for the cell grid (cells are the interactive surfaces); the
     table-vs-grid role question is the 1.1 shell a11y decision. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={tableEl}
	class="table-block"
	role="table"
	style:grid-template-columns={trackTemplate}
	oncontextmenu={openCellMenu}
	onkeydown={onTableKeyDown}
>
	<!-- The corner occupies the zero-width gutter so the column grips align to their
	     columns. The block boundaries below stay whitespace-adjacent: a stray text node
	     joins the raw-offset walk and shifts a parked caret (cursor/widget-offset.ts). -->
	<span class="table-grip-corner" aria-hidden="true"></span>{#each columnIndices as colIdx (colIdx)}
		<TableGrip
			axis="column"
			onActivate={(e) => {
				if (suppressColumnGripClick) return;
				openMenu('column', colIdx, e);
			}}
			onpointerdown={(e) => onColumnGripPointerDown(colIdx, e)}
		/>
	{/each}{#if win.active}
		<div class="vr-spacer" style="height: {win.topSpacerPx}px"></div>
	{/if}{#each (node.children ?? []).slice(bounds.start, bounds.end) as rowNode, localIndex (rowsState.innerBlockIds[bounds.start + localIndex])}
		<!-- ABSOLUTE-INDEX INVARIANT: index/rowIdx/myPath/key carry the absolute row index
		     (bounds.start + localIndex), never the local loop index. -->
		{@const rowIdx = bounds.start + localIndex}
		<TableRowBlock
			node={rowNode}
			index={rowIdx}
			id={rowsState.innerBlockIds[rowIdx]}
			{rowIdx}
			{columnCount}
			{rowCount}
			alignments={meta?.alignments ?? []}
			myPath={[...myPath, rowIdx]}
			slots={rowsState.refSlots}
			onOpenRowMenu={(r, e) => {
				if (suppressRowGripClick) return;
				openMenu('row', r, e);
			}}
			{onRowGripPointerDown}
		/>
	{/each}{#if win.active}
		<div class="vr-spacer" style="height: {win.bottomSpacerPx}px"></div>
	{/if}{#if menu}
		<TableActionMenu
			items={menuItems}
			x={menu.x}
			y={menu.y}
			onaction={runAction}
			onclipboard={runClipboard}
			onalign={runAlign}
			onclose={() => (menu = null)}
			onescape={closeMenuRestoringFocus}
		/>
	{/if}{#if dragLine}
		<div
			class="table-reorder-line"
			style="left:{dragLine.left}px;top:{dragLine.top}px;width:{dragLine.width}px"
		></div>
	{/if}{#if columnDragLine}
		<div
			class="table-reorder-line-vertical"
			style="left:{columnDragLine.left}px;top:{columnDragLine.top}px;height:{columnDragLine.height}px"
		></div>
	{/if}
</div>

<style>
	.table-block {
		display: grid;
		width: max-content;
		max-width: 100%;
		overflow-x: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--color-ui-muted, #a4a4a4) transparent;
	}
	/* Spacers are direct grid children; span all columns to reserve a full row band. */
	.vr-spacer {
		grid-column: 1 / -1;
	}
	/* Zero-height so the corner + column-grip band (grid row 1) adds no visible row. */
	.table-grip-corner {
		height: 0;
	}
	/* Viewport-fixed, matching the client coords the drag measures in; pointer-events:none
	   so the overlay never intercepts the drag's own pointer stream. */
	.table-reorder-line,
	.table-reorder-line-vertical {
		position: fixed;
		background: var(--md-reorder-indicator);
		border-radius: 2px;
		pointer-events: none;
		z-index: 20;
	}
	.table-reorder-line {
		height: 2px;
	}
	.table-reorder-line-vertical {
		width: 2px;
	}
	/* Fallback for Chromium versions that don't honor `scrollbar-width`. */
	.table-block::-webkit-scrollbar {
		height: 6px;
	}
	.table-block::-webkit-scrollbar-track {
		background: transparent;
	}
	.table-block::-webkit-scrollbar-thumb {
		background: var(--color-ui-muted, #a4a4a4);
		border-radius: 3px;
	}
	.table-block::-webkit-scrollbar-thumb:hover {
		background: var(--color-ui-dulled, #afb1b3);
	}
</style>
