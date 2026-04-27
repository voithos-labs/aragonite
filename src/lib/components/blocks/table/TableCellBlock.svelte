<script lang="ts">
	import { getContext, tick } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		CONTROLLER_KEY,
		PASTE_COORDINATOR_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		CONTAINER_EDIT_KEY,
		STICKY_COLUMN_KEY,
		SELECTION_KEY,
		BLOCK_EL_LOOKUP_KEY,
		DOC_KEY,
		EDITOR_ROOT_KEY,
		EDITOR_LIFETIME_KEY,
		TABLE_CONTEXT_KEY,
		type BlockEditActions,
		type BlockElLookup,
		type ContainerEditActions,
		type DocumentGetter,
		type FocusActions,
		type HistoryActions,
		type CstNode,
		type BlockComponent,
		type StickyColumnDirection,
		type TableContext
	} from '../../../contracts';
	import type { UndoController } from '../../../editor-actions/deps';
	import type { PasteCommitCoordinator } from '../../../tree-operations/paste/paste-deps';
	import type { StickyColumnState } from '../../../cursor/sticky-column';
	import type { TableMetadata } from '../../../core/nodes';
	import { trimTrailingLineEnding, normalizeLineEndings } from '../../../core/lines';
	import { nodeAt } from '../../../tree-operations/node-ops';
	import { pathsEqual } from '../../../selection/path-math';
	import { collectCrossBlockText } from '../../../selection/clipboard-text';
	import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
	import {
		createRangeFromOffsets,
		setCursorOffset as setCursorOffsetHelper,
		getCursorOffset as getCursorOffsetHelper,
		getSelectionFocusOffset as getSelectionFocusOffsetHelper,
		getSelectionOffsets as getSelectionOffsetsHelper,
		hasSelection as hasSelectionHelper
	} from '../../../cursor/cursor-utils';
	import {
		findOffsetNearestX,
		getCurrentCursorEditorRelativeX
	} from '../../../cursor/sticky-measure';
	import { measurePartialRectsInContentEditable } from '../../../cursor/overlay-rects';
	import {
		handleSharedKeydown,
		handleSharedBeforeInput,
		type SharedKeydownContext
	} from '../../../selection/shared-keydown';
	import type { SelectionState } from '../../../selection/selection-state.svelte';
	import { createCrossBlockHandlers } from '../../../selection/cross-block-dispatch';
	import { resetForPointerDown } from '../../../selection/cross-block-pointer';
	import { selectWholeDocument } from '../../../selection/keyboard-extend';
	import { nextCell, prevCell, cellAbove, cellBelow } from './table-navigation';
	import { copyRectangleAsSubTable } from './sub-table-copy';
	import {
		installCellDragListener,
		handleCellShiftClick,
		cellCoordsOfElement,
		type CellAnchor
	} from './cell-pointer';

	type ExitDirection = 'up' | 'down';

	const ctrlOrMeta = (e: KeyboardEvent): boolean => e.ctrlKey || e.metaKey;

	const Q3_SHORTCUTS: Array<{
		match: (e: KeyboardEvent) => boolean;
		run: (ctx: TableContext, pos: { rowIdx: number; colIdx: number }) => Promise<void>;
	}> = [
		{
			match: (e) => ctrlOrMeta(e) && e.key === 'Enter' && !e.shiftKey && !e.altKey,
			run: (ctx, p) => ctx.insertRowBelow(p.rowIdx)
		},
		{
			match: (e) => ctrlOrMeta(e) && e.key === 'Enter' && e.shiftKey && !e.altKey,
			run: (ctx, p) => ctx.insertRowAbove(p.rowIdx)
		},
		{
			match: (e) => e.altKey && e.shiftKey && !ctrlOrMeta(e) && e.key === 'ArrowRight',
			run: (ctx, p) => ctx.insertColumnRight(p.colIdx)
		},
		{
			match: (e) => e.altKey && e.shiftKey && !ctrlOrMeta(e) && e.key === 'ArrowLeft',
			run: (ctx, p) => ctx.insertColumnLeft(p.colIdx)
		},
		{
			match: (e) => ctrlOrMeta(e) && e.shiftKey && !e.altKey && e.key === 'Backspace',
			run: (ctx, p) => ctx.deleteRow(p.rowIdx)
		},
		{
			match: (e) => e.altKey && e.shiftKey && !ctrlOrMeta(e) && e.key === 'Backspace',
			run: (ctx, p) => ctx.deleteColumn(p.colIdx)
		},
		{
			match: (e) =>
				ctrlOrMeta(e) && e.shiftKey && !e.altKey && (e.key === 'A' || e.key === 'a'),
			run: (ctx, p) => ctx.cycleAlignment(p.colIdx)
		}
	];

	let {
		node,
		index,
		myPath = [],
		rowIdx,
		colIdx,
		columnCount,
		rowCount
	}: {
		node: CstNode;
		index: number;
		myPath?: number[];
		rowIdx: number;
		colIdx: number;
		columnCount: number;
		rowCount: number;
	} = $props();

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const controller = getContext<UndoController>(CONTROLLER_KEY);
	const pasteCoordinator = getContext<PasteCommitCoordinator>(PASTE_COORDINATOR_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const containerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);
	const selection = getContext<SelectionState>(SELECTION_KEY);
	const getBlockElByPath = getContext<BlockElLookup>(BLOCK_EL_LOOKUP_KEY);
	const getDoc = getContext<DocumentGetter>(DOC_KEY);
	const getEditorRoot = getContext<() => HTMLElement | null>(EDITOR_ROOT_KEY);
	const editorLifetime = getContext<AbortSignal | undefined>(EDITOR_LIFETIME_KEY);
	const tableContext = getContext<TableContext>(TABLE_CONTEXT_KEY);

	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	let pendingCursorOffset = $state<number | null>(null);
	let preEditOffset = 0;

	const crossBlock = createCrossBlockHandlers({
		getEl: () => el ?? null,
		getMyPath: () => myPath,
		getIndex: () => index,
		selection,
		getDoc,
		getBlockElByPath,
		getEditorRoot,
		getEditorLifetime: () => editorLifetime ?? null,
		stickyColumn,
		containerEdit,
		blockEdit,
		controller,
		pasteCoordinator,
		getCursorOffset: () => (el ? (getCursorOffsetHelper(el) ?? null) : null),
		afterReactivity: () => tick(),
		setPendingCursor: (offset) => {
			pendingCursorOffset = offset;
		}
	});

	const sharedCtx: SharedKeydownContext = {
		getEl: () => el ?? null,
		getCursorOffset: () => (el ? getCursorOffsetHelper(el) : null),
		getFocusOffset: () => (el ? getSelectionFocusOffsetHelper(el) : null),
		getTextLen: () => (el?.textContent ?? '').length,
		getMyPath: () => myPath,
		getIndex: () => index,
		crossBlock,
		selection,
		stickyColumn,
		history,
		focus: focusActions,
		getDoc,
		getBlockElByPath
	};

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export function focus(offset: number): void {
		if (!el) return;
		el.focus();
		setCursorOffsetHelper(el, Math.max(0, offset));
	}

	export function focusAtColumn(x: number, from: StickyColumnDirection): void {
		if (!el) return;
		el.focus();
		setCursorOffsetHelper(el, findOffsetNearestX(el, x, from));
	}

	export function getCursorOffset(): number | null {
		return el ? getCursorOffsetHelper(el) : null;
	}

	export function getSelectedText(): string {
		return window.getSelection()?.toString() ?? '';
	}

	export function setSelection(start: number, end: number): void {
		if (!el) return;
		const range = createRangeFromOffsets(el, start, end);
		if (!range) return;
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	export function measurePartialRects(startOffset: number, endOffset: number): DOMRect[] {
		if (!el) return [];
		return measurePartialRectsInContentEditable(el, startOffset, endOffset);
	}

	void ({ editable, focusable, focus, getCursorOffset, focusAtColumn } satisfies BlockComponent);

	// ── Render pipeline ────────────────────────────────────────────────────

	function getDisplayText(): string {
		return trimTrailingLineEnding(node.raw);
	}

	$effect(() => {
		if (!el) return;
		const display = getDisplayText();
		if (el.textContent !== display) {
			el.textContent = display;
		}
		if (pendingCursorOffset !== null) {
			setCursorOffsetHelper(el, pendingCursorOffset);
			pendingCursorOffset = null;
		}
	});

	// ── Event handlers ─────────────────────────────────────────────────────

	function onInput(): void {
		stickyColumn.reset();
		if (composing || !el) return;
		const text = el.textContent ?? '';
		const savedOffset = getCursorOffsetHelper(el) ?? 0;
		blockEdit.updateBlockContent(index, text, preEditOffset, savedOffset);
		pendingCursorOffset = savedOffset;
	}

	function onCompositionStart(): void {
		if (!el) return;
		preEditOffset = getCursorOffsetHelper(el) ?? 0;
		crossBlock.handleCompositionStart();
		composing = true;
	}

	function onCompositionEnd(): void {
		composing = false;
		onInput();
	}

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing || !el) return;

		preEditOffset = getCursorOffsetHelper(el) ?? 0;
		const pos = { rowIdx, colIdx };
		const textLen = (el.textContent ?? '').length;
		const offset = preEditOffset;
		const collapsed = !hasSelectionHelper();

		if (ctrlOrMeta(e) && e.key === 'a' && !e.shiftKey && !e.altKey) {
			await handleCellSelectAll(e);
			return;
		}

		for (const s of Q3_SHORTCUTS) {
			if (s.match(e)) {
				e.preventDefault();
				await s.run(tableContext, pos);
				return;
			}
		}

		if (e.key === 'ArrowLeft' && !e.shiftKey && offset === 0 && collapsed) {
			e.preventDefault();
			handleHorizontalMove(prevCell(pos, columnCount), 'end', 'up');
			return;
		}

		if (e.key === 'ArrowRight' && !e.shiftKey && offset === textLen && collapsed) {
			e.preventDefault();
			const move = nextCell(pos, columnCount, rowCount);
			if (move.kind === 'cell') {
				tableContext.focusCell(move.rowIdx, move.colIdx, 'start');
			} else {
				exitWithStickyX('down');
			}
			return;
		}

		if (e.key === 'ArrowUp' && !e.shiftKey) {
			e.preventDefault();
			handleVerticalMove(cellAbove(pos), 'end', 'up');
			return;
		}

		if (e.key === 'ArrowDown' && !e.shiftKey) {
			e.preventDefault();
			handleVerticalMove(cellBelow(pos, rowCount), 'start', 'down');
			return;
		}

		if (e.key === 'Tab' && !e.shiftKey) {
			e.preventDefault();
			const move = nextCell(pos, columnCount, rowCount);
			if (move.kind === 'cell') {
				tableContext.focusCell(move.rowIdx, move.colIdx, 'start');
			} else {
				await tableContext.insertRowBelow(rowIdx);
			}
			return;
		}

		if (e.key === 'Tab' && e.shiftKey) {
			e.preventDefault();
			handleHorizontalMove(prevCell(pos, columnCount), 'end', 'up');
			return;
		}

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			const move = cellBelow(pos, rowCount);
			if (move.kind === 'cell') {
				tableContext.focusCell(move.rowIdx, move.colIdx, 'start');
			} else {
				await tableContext.insertRowBelow(rowIdx);
			}
			return;
		}

		if (e.key === 'Backspace' && offset === 0 && collapsed) {
			e.preventDefault();
			const move = prevCell(pos, columnCount);
			if (move.kind === 'cell') {
				tableContext.focusCell(move.rowIdx, move.colIdx, 'end');
			} else {
				exitWithStickyX('up');
			}
			return;
		}

		if (e.key === 'Delete' && offset === textLen && collapsed) {
			e.preventDefault();
			const move = nextCell(pos, columnCount, rowCount);
			if (move.kind === 'cell') {
				tableContext.focusCell(move.rowIdx, move.colIdx, 'start');
			} else {
				exitWithStickyX('down');
			}
			return;
		}

		await handleSharedKeydown(e, sharedCtx);
	}

	// Cells override the document-level 2-stage Ctrl+A with a 3-stage table-aware variant.
	async function handleCellSelectAll(e: KeyboardEvent): Promise<void> {
		const count = selection.selectAllCount;
		if (count === 0) {
			selection.incrementSelectAllCount();
			return;
		}
		if (count === 1) {
			e.preventDefault();
			selection.incrementSelectAllCount();
			const tablePath = myPath.slice(0, -2);
			selection.enterCrossBlock(
				{ path: tablePath, offset: 0 },
				{ path: tablePath, offset: columnCount * rowCount - 1 }
			);
			return;
		}
		e.preventDefault();
		selection.incrementSelectAllCount();
		selectWholeDocument(selection, getDoc(), getBlockElByPath);
	}

	function handleHorizontalMove(
		move: ReturnType<typeof prevCell>,
		cellPosition: 'start' | 'end',
		exit: ExitDirection
	): void {
		if (move.kind === 'cell') {
			tableContext.focusCell(move.rowIdx, move.colIdx, cellPosition);
			return;
		}
		exitWithStickyX(exit);
	}

	function handleVerticalMove(
		move: ReturnType<typeof cellAbove> | ReturnType<typeof cellBelow>,
		cellPosition: 'start' | 'end',
		exit: ExitDirection
	): void {
		if (move.kind === 'cell') {
			tableContext.setStickyColumn(move.colIdx);
			tableContext.focusCell(move.rowIdx, move.colIdx, cellPosition);
			return;
		}
		exitWithStickyX(exit);
	}

	function exitWithStickyX(direction: ExitDirection): void {
		if (!el) return;
		const x = getCurrentCursorEditorRelativeX(el) ?? 0;
		if (direction === 'up') tableContext.exitUpward(x);
		else tableContext.exitDownward(x);
	}

	async function onBeforeInput(e: InputEvent): Promise<void> {
		if (await handleSharedBeforeInput(e, sharedCtx)) return;
		if (e.inputType === 'insertLineBreak') {
			e.preventDefault();
			return;
		}
	}

	function onPointerDown(e: PointerEvent): void {
		if (!el) return;
		const tableEl = el.closest('[role="table"]') as HTMLElement | null;
		if (!tableEl) {
			crossBlock.handlePointerDown(e);
			return;
		}
		const tablePath = myPath.slice(0, -2);
		const anchor: CellAnchor = {
			tableEl,
			tablePath,
			rowIdx,
			colIdx,
			columnCount
		};

		resetForPointerDown(selection, stickyColumn, e.shiftKey);

		if (e.shiftKey) {
			const prevCoords = cellCoordsOfElement(document.activeElement, tableEl);
			if (prevCoords && (prevCoords.rowIdx !== rowIdx || prevCoords.colIdx !== colIdx)) {
				handleCellShiftClick(
					selection,
					{ ...anchor, rowIdx: prevCoords.rowIdx, colIdx: prevCoords.colIdx },
					{ rowIdx, colIdx }
				);
				e.preventDefault();
				return;
			}
			crossBlock.handlePointerDown(e);
			return;
		}

		const editorRoot = getEditorRoot();
		if (!editorRoot) return;
		installCellDragListener(
			{ editorRoot, selection, lifetimeSignal: editorLifetime },
			anchor
		);
	}

	function onCopy(e: ClipboardEvent): void {
		stickyColumn.reset();
		const sel = selection;
		const isIntraTableMultiCell =
			sel.isCustomRendered &&
			sel.anchor &&
			sel.focus &&
			pathsEqual(sel.anchor.path, sel.focus.path);

		if (isIntraTableMultiCell && sel.anchor && sel.focus) {
			const tableNode = nodeAt(getDoc(), sel.anchor.path);
			if (!tableNode || !('kind' in tableNode) || tableNode.kind !== 'table') return;
			e.preventDefault();
			const colCount = (tableNode.metadata as TableMetadata).columnCount;
			const a = {
				rowIdx: Math.floor(sel.anchor.offset / colCount),
				colIdx: sel.anchor.offset % colCount
			};
			const b = {
				rowIdx: Math.floor(sel.focus.offset / colCount),
				colIdx: sel.focus.offset % colCount
			};
			e.clipboardData?.setData('text/plain', copyRectangleAsSubTable(tableNode, a, b));
			return;
		}

		if (sel.isCrossBlock && sel.anchor && sel.focus) {
			e.preventDefault();
			e.clipboardData?.setData(
				'text/plain',
				collectCrossBlockText(getDoc(), sel.anchor, sel.focus)
			);
			return;
		}
	}

	async function onPaste(e: ClipboardEvent): Promise<void> {
		if (await crossBlock.handlePaste(e)) return;

		stickyColumn.reset();
		if (!el) return;
		e.preventDefault();
		const pastedText = normalizeLineEndings(e.clipboardData?.getData('text/plain') ?? '');
		if (!pastedText) return;

		const selOffsets = getSelectionOffsetsHelper(el);
		const offset = selOffsets ? selOffsets.start : (getCursorOffsetHelper(el) ?? 0);

		const result = await pasteDispatch(
			{
				pastedText,
				targetPath: myPath,
				offset,
				preDelete: selOffsets ? { start: selOffsets.start, end: selOffsets.end } : undefined
			},
			{
				doc: getDoc(),
				blockEdit,
				controller: pasteCoordinator
			}
		);

		if (result.inlineCaretOffset !== undefined) {
			pendingCursorOffset = result.inlineCaretOffset;
		}
	}

	function onFocus(): void {
		tableContext.notifyCellFocused(rowIdx, colIdx);
	}

	function onBlur(): void {
		tableContext.notifyCellBlurred();
	}
</script>

<div
	bind:this={el}
	tabindex="0"
	class="table-cell"
	contenteditable="true"
	role="cell"
	oninput={onInput}
	onkeydown={onKeyDown}
	onbeforeinput={onBeforeInput}
	onpointerdown={onPointerDown}
	oncopy={onCopy}
	onpaste={onPaste}
	onfocus={onFocus}
	onblur={onBlur}
	oncompositionstart={onCompositionStart}
	oncompositionend={onCompositionEnd}
></div>

<style>
	.table-cell {
		outline: none;
		padding: 4px 8px;
		min-height: 1.4em;
		white-space: pre-wrap;
		word-wrap: break-word;
		border: 1px solid var(--color-ui-muted, rgba(128, 128, 128, 0.3));
	}
	.table-cell:focus {
		outline: 2px solid var(--color-accent, #4a9eff);
		outline-offset: -2px;
	}
</style>
