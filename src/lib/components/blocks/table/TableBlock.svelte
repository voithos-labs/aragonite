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
		CURSOR_START,
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
	import { cellAtPoint, installCellDragListener, mountedRowEls, rowCellEls } from './cell-pointer';
	import { tableCaretAtPoint } from './table-caret-at-point';
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
	import TableRowBlock from './TableRowBlock.svelte';
	import TableActionMenu from './TableActionMenu.svelte';
	import MenuIcon from '../../menu/MenuIcon.svelte';
	import { ADD_COLUMN_RIGHT, ADD_ROW_BELOW } from '../../../a11y-strings';
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
		lifetime: editorLifetime,
		linkRef
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const { presentationMode: getPresentationMode } = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	// Every menu item mutates the table, so reading mode declines to open it and the
	// native context menu (with Copy) shows instead.
	const readOnly = $derived(getPresentationMode() === 'reading');

	const meta = $derived(metadataOf(node, 'table'));
	const rowCount = $derived(node.children?.length ?? 0);
	const columnCount = $derived(meta.columnCount);

	// A column reorder permutes cells while leaving columnCount and widthVersion untouched, so it
	// alone can't invalidate the monotonic width floors below; the header row's cell bytes permute
	// with it, so the measure epoch folds them in. The bytes, not the row's `childIds`: those are
	// minted at the row's first mount, so a windowed-out header row would hold the epoch still
	// across the very reorder it exists to catch.
	const columnStructureToken = $derived(
		// The grammar keeps a cell to one line, so a newline joiner cannot be confused for content.
		(node.children?.[0]?.children ?? []).map((cell) => cell.raw).join('\n')
	);

	// Plain `let`, not $state: writes happen during keyed-each reconcile via
	// the focusout handler, which Svelte 5 traps as state_unsafe_mutation.
	let internalStickyColumn: number | null = null;
	let focusedCell: { rowIdx: number; colIdx: number } | null = null;
	// The reactive mirror the edge affordances read, written a microtask after the plain one so
	// a focusout fired mid-reconcile never mutates state inside the render.
	let caretCell = $state<{ rowIdx: number; colIdx: number } | null>(null);
	function mirrorCaretCell(): void {
		void tick().then(() => {
			caretCell = focusedCell;
		});
	}
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
		getPresentationMode,
		linkRef,
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

	const trackTemplate = $derived(
		Array.from({ length: columnCount }, (_, c) => {
			const floor = Math.max(80, columnMaxWidths[c] ?? 0);
			return `minmax(${floor}px, max-content)`;
		}).join(' ')
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
		grammar: registryView.grammar,
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
			mirrorCaretCell();
		},
		notifyCellBlurred() {
			focusedCell = null;
			mirrorCaretCell();
		},
		...mutations
	};

	setContext(TABLE_CONTEXT_KEY, ctx);

	// ── Cell menu ──────────────────────────────────────────────────────────

	// clipboardSel is the cell's selection captured at right-click, before the menu steals
	// focus; null for an empty cell with no caret.
	type CellSelection = { start: number; end: number };
	let menu = $state<{
		target: { rowIdx: number; colIdx: number };
		x: number;
		y: number;
		clipboardSel: CellSelection | null;
		/** Re-reads the open point where its element is now (scroll, resize). */
		anchor?: () => { x: number; y: number } | null;
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

	// Notion's edge affordances: a strip past the table's right edge adds a column, one below
	// it adds a row. Each shows on hover of its strip, and stays shown while the caret is in
	// the last column / row. Geometry is the table's own box, measured after layout settles and
	// again whenever the table resizes.
	const addAffordance = $derived({
		column: !readOnly && caretCell?.colIdx === columnCount - 1,
		row: !readOnly && caretCell?.rowIdx === rowCount - 1
	});
	let addGeometry = $state<{ left: number; top: number; width: number; height: number } | null>(
		null
	);
	$effect(() => {
		const el = tableEl;
		if (readOnly || !el) {
			addGeometry = null;
			return;
		}
		const measure = () => {
			addGeometry = {
				left: el.offsetLeft,
				top: el.offsetTop,
				width: el.offsetWidth,
				height: el.offsetHeight
			};
		};
		void tick().then(measure);
		const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
		observer?.observe(el);
		return () => observer?.disconnect();
	});

	// The open point as an offset into an element's box, so a scroll re-reads it where the
	// element is now rather than where the viewport left it.
	function anchorOn(el: Element, point: { x: number; y: number }): () => { x: number; y: number } {
		const rect = el.getBoundingClientRect();
		const dx = point.x - rect.left;
		const dy = point.y - rect.top;
		return () => {
			const now = el.getBoundingClientRect();
			return { x: now.left + dx, y: now.top + dy };
		};
	}

	function cellRefAt(rowIdx: number, colIdx: number): BlockComponent | null {
		return getBlockComponentByPath([rowIdx, colIdx]);
	}

	// Capture the cell's selection now, before a menu-item click moves focus off it, so
	// Cut/Copy have a range to act on.
	function openMenuAtCell(rowIdx: number, colIdx: number, x: number, y: number): void {
		const clipboardSel = cellRefAt(rowIdx, colIdx)?.getSelectionOffsets?.() ?? null;
		const cellEl = cellElementAt(rowIdx, colIdx);
		const anchor = cellEl ? anchorOn(cellEl, { x, y }) : undefined;
		menu = { target: { rowIdx, colIdx }, x, y, clipboardSel, anchor };
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

	// The restore goes through `focusCell`: a bare `el.focus()` on a contenteditable seats no
	// typeable caret.
	async function closeMenuRestoringFocus(): Promise<void> {
		const target = menu?.target;
		const offset = menu?.clipboardSel?.start ?? 'start';
		menu = null;
		if (!target) return;
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
		await cellRefAt(rowIdx, colIdx)?.applyMenuClipboard?.(action, sel);
	}

	async function runAlign(alignment: 'left' | 'center' | 'right'): Promise<void> {
		const colIdx = menu?.target.colIdx;
		if (colIdx == null) return;
		await ctx.setColumnAlignment(colIdx, alignment);
		menu = null;
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
	function tableLanding(offset: number): {
		rowIdx: number;
		colIdx: number;
		position: CellPosition;
	} {
		return offset === 0 || offset === CURSOR_START
			? { rowIdx: 0, colIdx: 0, position: 'start' }
			: { rowIdx: rowCount - 1, colIdx: columnCount - 1, position: 'end' };
	}

	export const focus = placeCaret(selection, (offset: number) => {
		if (rowCount === 0) return;
		const { rowIdx, colIdx, position } = tableLanding(offset);
		focusCell(rowIdx, colIdx, position);
	});

	export function parkCaret(offset: number): void {
		if (rowCount === 0) return;
		const { rowIdx, colIdx, position } = tableLanding(offset);
		cellRefAt(rowIdx, colIdx)?.parkCaret?.(position === 'start' ? CURSOR_START : CURSOR_END);
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
		await revealChildOrWait(rowIdx, {
			slots: rowsState.refSlots,
			childCount: rowCount,
			revealChild: windowing.revealChild,
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

	// A press beside the table runs the same cell drag a press IN a cell runs, anchored at the
	// nearest cell — so a sweep that starts in the margin grows the same rectangle it would from
	// that cell, and leaves the table as a cross-block range the same way.
	export function startDragAtPoint(clientX: number, clientY: number, e: PointerEvent): boolean {
		if (!tableEl || readOnly) return false;
		const host = tableEl.parentElement;
		const target = host ? tableCaretAtPoint(host, clientX, clientY) : null;
		const editorRoot = getEditorRoot();
		if (!target || !editorRoot) return false;
		const [rowIdx, colIdx] = target.path;
		installCellDragListener(
			{ editorRoot, selection, lifetimeSignal: editorLifetime },
			{ tableEl, tablePath: myPath.slice(), rowIdx, colIdx, columnCount },
			e
		);
		return true;
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
	<!-- The block boundaries stay whitespace-adjacent: a stray text node joins the raw-offset
	     walk and shifts a parked caret (cursor/widget-offset.ts). -->
	{#if win.active}
		<div class="vr-spacer" style="height: {win.topSpacerPx}px"></div>
	{/if}{#each (node.children ?? []).slice(bounds.start, bounds.end) as rowNode, localIndex (rowsState.innerBlockIds[bounds.start + localIndex])}
		<!-- ABSOLUTE-INDEX INVARIANT: index/myPath/key carry the absolute row index
		     (bounds.start + localIndex), never the local loop index. -->
		{@const rowIdx = bounds.start + localIndex}
		<TableRowBlock
			node={rowNode}
			index={rowIdx}
			id={rowsState.innerBlockIds[rowIdx]}
			{columnCount}
			{rowCount}
			alignments={meta.alignments ?? []}
			myPath={[...myPath, rowIdx]}
			slots={rowsState.refSlots}
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
			anchor={menu.anchor}
			onclose={() => (menu = null)}
			onescape={closeMenuRestoringFocus}
		/>
	{/if}
</div>
{#if addGeometry}<div
		class="table-add-zone table-add-zone-column"
		class:table-add-pinned={addAffordance.column}
		style="left:{addGeometry.left +
			addGeometry.width}px;top:{addGeometry.top}px;height:{addGeometry.height}px"
	>
		<button
			type="button"
			class="table-add table-add-column"
			aria-label={ADD_COLUMN_RIGHT}
			title={ADD_COLUMN_RIGHT}
			onmousedown={(e) => e.preventDefault()}
			onclick={() => void ctx.insertColumnRight(columnCount - 1)}
			><MenuIcon name="plus" size={12} /></button
		>
	</div>
	<div
		class="table-add-zone table-add-zone-row"
		class:table-add-pinned={addAffordance.row}
		style="left:{addGeometry.left}px;top:{addGeometry.top +
			addGeometry.height}px;width:{addGeometry.width}px"
	>
		<button
			type="button"
			class="table-add table-add-row"
			aria-label={ADD_ROW_BELOW}
			title={ADD_ROW_BELOW}
			onmousedown={(e) => e.preventDefault()}
			onclick={() => void ctx.insertRowBelow(rowCount - 1)}
			><MenuIcon name="plus" size={12} /></button
		>
	</div>{/if}

<style>
	.table-block {
		display: grid;
		width: max-content;
		max-width: 100%;
		overflow-x: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border, #3e3e3b) transparent;
		/* The two sides the cells do not draw — see `.table-cell`. */
		border-top: 1px solid var(--color-border, #3e3e3b);
		border-left: 1px solid var(--color-border, #3e3e3b);
	}
	/* The edge strips sit in the host's box beside and below the grid, out of the grid's own
	   scroller, and start exactly at the table's edge so they never cover a cell. Pure-CSS
	   reveal on hover; `.table-add-pinned` is the caret's claim. The mousedown is swallowed so
	   the cell keeps the caret that pinned them. */
	.table-add-zone {
		position: absolute;
		z-index: 3;
		display: flex;
	}
	.table-add-zone-column {
		width: 28px;
		padding-left: 4px;
		align-items: stretch;
	}
	.table-add-zone-row {
		height: 22px;
		padding-top: 4px;
		flex-direction: column;
		align-items: stretch;
	}
	.table-add {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px solid var(--color-border, #3e3e3b);
		border-radius: 3px;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		color: var(--color-ui-muted, #8f8f89);
		cursor: pointer;
		opacity: 0;
		transition: opacity 120ms ease-out;
	}
	.table-add-pinned .table-add {
		opacity: 0.7;
	}
	.table-add-zone:hover .table-add,
	.table-add:focus-visible {
		opacity: 1;
		color: var(--color-text-primary, #e8e8e5);
	}
	.table-add-column {
		width: 18px;
	}
	.table-add-row {
		height: 16px;
	}
	@media (prefers-reduced-motion: reduce) {
		.table-add {
			transition: none;
		}
	}
	/* Spacers are direct grid children; span all columns to reserve a full row band. */
	.vr-spacer {
		grid-column: 1 / -1;
	}
	/* Fallback for Chromium versions that don't honor `scrollbar-width`. */
	.table-block::-webkit-scrollbar {
		height: 6px;
	}
	.table-block::-webkit-scrollbar-track {
		background: transparent;
	}
	.table-block::-webkit-scrollbar-thumb {
		background: var(--color-border, #3e3e3b);
		border-radius: 3px;
	}
	.table-block::-webkit-scrollbar-thumb:hover {
		background: var(--color-ui-dulled, #afb1b3);
	}
</style>
