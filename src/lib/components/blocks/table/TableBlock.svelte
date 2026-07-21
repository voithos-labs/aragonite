<script lang="ts">
	import { setContext, getContext, untrack, tick } from 'svelte';
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
	import { asEditorX, cellRowCol } from '../../../cursor/coordinate-spaces';
	import { pathsEqual } from '../../../selection/path-math';
	import { columnNearestX } from './cell-x-mapping';
	import { cellAtPoint, mountedRowEls, rowCellEls } from './cell-pointer';
	import { intraTableRect } from './cell-clipboard';
	import { createBlockListState } from '../../../reactivity/block-list-state.svelte';
	import { useContainerWindowing } from '../../../reactivity/use-container-windowing.svelte';
	import { sliceWindow } from '../../../reactivity/window-slice';
	import { revealChildOrWait } from '../../../reactivity/publish-ref.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
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
	import type { CellShortcutAction } from './cell-keydown-plan';

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
		widthVersion: getWidthVersion,
		lifetime: editorLifetime
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const getPresentationMode = getContext<EditorPolicies | undefined>(
		EDITOR_POLICIES_KEY
	)?.presentationMode;
	// Every menu item mutates the table (structure, clipboard cut/paste), so
	// reading mode declines to open it; the native context menu (with Copy) shows
	// instead. Grips are CSS-hidden under [data-presentation='reading'].
	const readOnly = $derived(getPresentationMode?.() === 'reading');

	const meta = $derived(metadataOf(node, 'table'));
	const rowCount = $derived(node.children?.length ?? 0);
	const columnCount = $derived(meta.columnCount);

	// A column reorder permutes each row's cells (and their childIds) while leaving
	// columnCount and widthVersion untouched, so it alone can't invalidate the
	// monotonic width floors. The header row's cell-id order tracks the column
	// order: it permutes on a reorder but is stable across row-window slides
	// (childIds are CST fields, mounting-independent) and content edits (cell ids
	// persist). Folded into the measure epoch below.
	const columnStructureToken = $derived((node.children?.[0]?.childIds ?? []).join(','));

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
		// The table is itself a BlockHost block; match the leaf channel the parent
		// measured for it, so the subtotal we report up doesn't fight that slot.
		getOwnEl: () => tableEl?.closest('.block-host') ?? null,
		provideLeafChannel: false
	});

	let win = $derived(windowing.window);
	let bounds = $derived(sliceWindow((node.children ?? []).length, win));

	// Pin each column track to the widest cell SEEN across all windowed-in rows, not just
	// the currently-mounted slice. `repeat(columnCount, minmax(80px, max-content))` alone
	// sizes a track to its mounted cells, so under row windowing a column jumps width as a
	// wide cell scrolls out of the mounted set (F6). The cached floor only grows, so the
	// track can't shrink when its widest cell unmounts; `max-content` stays the upper bound
	// so a still-wider cell scrolling IN still expands it (and feeds the cache). Reset on a
	// column-count change or a width re-wrap (`widthVersion`), which invalidate the cache.
	let columnMaxWidths = $state<number[]>([]);

	// Leading `0` track is the row-grip gutter (col 1). Width 0 keeps cell A's left
	// edge at the same x — no content shift, so caret pixel-measurement and sticky
	// column geometry are untouched; the row grip's dots overflow right into cell A's
	// left padding (mirrors the column grip overflowing into the header cell's top).
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

	// Re-measure when the mounted slice slides (`win` re-derives on every window recompute) or
	// after a column-count change / width re-wrap (both invalidate cached widths). Runs
	// post-flush, so the newly mounted rows are in the DOM. A column-count or width change
	// resets the cache first — the old maxes are stale (narrower wrap, shifted track set) and
	// monotonic-grow would otherwise pin a track too wide. Within a stable epoch it only grows
	// the floor and only bumps state on an increase, so it settles rather than spinning.
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
	// clipboardSel is the cell's raw selection captured at right-click, before the
	// menu steals focus — null for grip menus and for an empty cell with no caret.
	type CellSelection = { start: number; end: number };
	let menu = $state<{
		target: MenuTarget;
		x: number;
		y: number;
		clipboardSel: CellSelection | null;
	} | null>(null);

	// A live intra-table rectangle on THIS table (its shared endpoint path is this
	// table's). It suppresses the cell-local selection, so the menu reads it
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
		// Column grip sits atop its column → drop below it; row grip sits in the left
		// gutter → open beside it so the menu clears the table's left edge.
		menu =
			axis === 'column'
				? { target, x: rect.left, y: rect.bottom, clipboardSel: null }
				: { target, x: rect.right, y: rect.top, clipboardSel: null };
	}

	function cellRefAt(rowIdx: number, colIdx: number): BlockComponent | null {
		return rowRefAt(rowIdx)?.getBlockComponentByPath?.([colIdx]) ?? null;
	}

	// Open the both-axes cell menu (row group + column group + clipboard group).
	// Captures the cell's selection now, before a menu-item click moves focus off
	// it, so Cut/Copy have a range to act on.
	function openMenuAtCell(rowIdx: number, colIdx: number, x: number, y: number): void {
		const clipboardSel = cellRefAt(rowIdx, colIdx)?.getSelectionOffsets?.() ?? null;
		menu = { target: { rowIdx, colIdx }, x, y, clipboardSel };
	}

	// Right-click anywhere in a cell opens the menu at the pointer. Only
	// preventDefault when actually over a cell, so a right-click in the table's
	// padding gaps keeps the native menu.
	function openCellMenu(e: MouseEvent): void {
		if (readOnly || !tableEl) return;
		const cell = cellAtPoint(e.clientX, e.clientY, tableEl);
		if (!cell) return;
		e.preventDefault();
		openMenuAtCell(cell.rowIdx, cell.colIdx, e.clientX, e.clientY);
	}

	// Keyboard equivalent of the cell right-click: Shift+F10 / ContextMenu on a
	// focused cell opens the menu at that cell's rect. The event bubbles up from
	// the cell; preventDefault suppresses the native context menu the key triggers.
	function onTableKeyDown(e: KeyboardEvent): void {
		const opensMenu = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
		if (readOnly || !opensMenu || !focusedCell) return;
		e.preventDefault();
		const { rowIdx, colIdx } = focusedCell;
		const rect = cellElementAt(rowIdx, colIdx)?.getBoundingClientRect();
		openMenuAtCell(rowIdx, colIdx, rect ? rect.left : 0, rect ? rect.bottom : 0);
	}

	// Escape restores focus to the originating cell (cell menus only; grip menus
	// have no caret to return to). Caret lands where it was, via focusCell's offset
	// path — a bare el.focus() on a contenteditable doesn't seat a typeable caret.
	async function closeMenuRestoringFocus(): Promise<void> {
		const target = menu?.target;
		const offset = menu?.clipboardSel?.start ?? 'start';
		menu = null;
		if (target?.rowIdx == null || target?.colIdx == null) return;
		await tick();
		focusCell(target.rowIdx, target.colIdx, offset);
	}

	async function runAction(action: CellShortcutAction, axisIdx: number): Promise<void> {
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
	// Plain let: read only in the grip's pointer/click handlers. A drag that ends
	// off the grip fires no click, so this is reset on every grip pointerdown
	// rather than consumed on click — a stale `true` can't swallow a later menu.
	let suppressRowGripClick = false;

	// Rows are `display: contents` (no box); measure each MOUNTED row's first cell,
	// whose border-box spans the grid row track. Carries each row's ABSOLUTE index
	// (data-table-row-idx) so the drop maps a mounted edge to a body position under
	// row windowing. Re-read live each move, so an autoscroll re-slice is reflected.
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
		// Reset before any bail: a prior drag released off the grip leaves no click
		// to consume the flag, so resetting here is what keeps it from sticking.
		suppressRowGripClick = false;
		// The header row is positionally fixed (mirrors the keyboard no-op); its
		// grip stays click-only — no drag, no line.
		if (rowIdx === 0) return;
		startRowReorderDrag(e, {
			fromRowIdx: rowIdx,
			getRowCount: () => rowCount,
			getGeometry: rowReorderGeometry,
			// Row windowing scrolls the editor root (its getScrollEl); autoscroll must move
			// that exact element so off-window rows mount. Not nearestScrollContainer, which
			// counts overflow:hidden — a no-op autoscroll target (scroll-ancestors.ts header).
			getScrollContainer: getEditorRoot,
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

	// Columns aren't windowed, so every column cell is mounted; the shared track
	// geometry comes from the first mounted row. Client coords match the
	// position:fixed insertion line. Re-read live each move, so a horizontal-
	// autoscroll shift of the clipped columns is reflected.
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
		// Reset before any bail: a prior drag released off the grip leaves no click
		// to consume the flag, so resetting here is what keeps it from sticking.
		suppressColumnGripClick = false;
		startColumnReorderDrag(e, {
			fromColIdx: colIdx,
			getColCount: () => columnCount,
			getGeometry: columnReorderGeometry,
			// `.table-block` (tableEl) is itself the overflow-x container; autoscrolled
			// to reveal columns clipped off a wide table's edge.
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
		// A row scrolled off-window leaves a stale (detached) ref in this scope's slot —
		// the windowed each-block's cleanup is conditional and doesn't always clear it.
		// isStale gates the scroll on the live window bounds (truthiness alone is a cache,
		// not a mount oracle) and dropRef clears the detached ref so the mount-wait
		// resolves on the FRESH row.
		await revealChildOrWait(rowIdx, {
			childCount: rowCount,
			getRef: (i) => rowsState.innerBlockRefs[i],
			dropRef: (i) => (rowsState.innerBlockRefs[i] = undefined),
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

	export function cellRect(rowIdx: number, colIdx: number): DOMRect | null {
		const cellEl = cellElementAt(rowIdx, colIdx);
		return cellEl ? cellEl.getBoundingClientRect() : null;
	}

	export function mountedRowWindow(): { start: number; end: number } {
		return { start: win.start, end: win.end };
	}

	function collectSelectedCells(start: number, end: number): { rowIdx: number; colIdx: number }[] {
		const rect = selection ? intraTableRect(selection) : null;

		if (rect) {
			const { row: aRow, col: aCol } = cellRowCol(rect.anchorCellIdx, columnCount);
			const { row: fRow, col: fCol } = cellRowCol(rect.focusCellIdx, columnCount);
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
			const { row, col } = cellRowCol(i, columnCount);
			cells.push({ rowIdx: row, colIdx: col });
		}
		return cells;
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
		// Editor-relative space matches the captured sticky X (which is also
		// editor-relative). cell.getBoundingClientRect() already accounts for
		// the table's internal scroll position.
		const editorLeft = editorRoot.getBoundingClientRect().left;
		return rowCellEls(firstRowEl).map((c) => {
			const r = c.getBoundingClientRect();
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
	<!-- Corner occupies the zero-width row-grip gutter (col 1) so the column grips align
	     to their columns (cols 2..N+1), not the gutter; carries no grip attribute. The
	     grid's block boundaries below are kept whitespace-adjacent: a stray text node
	     directly under .table-block joins the raw-offset walk and shifts a parked
	     cross-block caret (cursor/widget-offset.ts; mirrors TableRowBlock). -->
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
		<!-- ABSOLUTE-INDEX INVARIANT: index/rowIdx/myPath/key are the absolute row
		     index (bounds.start + localIndex), never the local loop index. When
		     inactive, bounds are {0, rowCount} so rowIdx === the loop index. -->
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
			setRef={setRowRef}
			getRef={getRowRef}
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
	/* Drag overlay: viewport-fixed (rect from getBoundingClientRect / pointer client
	   coords); pointer-events:none so it never intercepts the drag's own pointer
	   stream. A single subtle line, not a band — a document should feel like a
	   document. Horizontal marks a row gap; vertical marks a column gap. */
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
