<script lang="ts">
	import { getContext, tick } from 'svelte';
	import type {
		BlockEditActions,
		ContainerEditActions,
		FocusActions,
		HistoryActions,
		TableContext
	} from '../../../action-contracts';
	import { type BlockComponent, type StickyColumnDirection } from '../../../block-component';
	import { dispatchKeyCommand, type CommandId } from '../../../schema/commands';
	import { eventToChord } from '../../../schema/keybindings';
	import { toggleInlineFormat } from '../text/format-toggle';
	import type { CstNode } from '../../../core/nodes';
	import {
		BLOCK_EDIT_KEY,
		BLOCK_EL_LOOKUP_KEY,
		CONTAINER_EDIT_KEY,
		CONTROLLER_KEY,
		DOC_KEY,
		EDITOR_LIFETIME_KEY,
		EDITOR_ROOT_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		LINK_REF_KEY,
		PASTE_COORDINATOR_KEY,
		SELECTION_KEY,
		STICKY_COLUMN_KEY,
		TABLE_CONTEXT_KEY,
		type BlockElLookup,
		type DocumentGetter,
		type LinkReferenceResolverRef
	} from '../../../editor-keys';
	import type { UndoController } from '../../../editor-actions/deps';
	import type { PasteCommitCoordinator } from '../../../tree-operations/paste/paste-deps';
	import type { StickyColumnState } from '../../../cursor/sticky-column';
	import type { TableAlignment } from '../../../core/nodes';
	import { trimTrailingLineEnding, normalizeLineEndings } from '../../../core/lines';
	import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
	import { hasSelection as hasSelectionHelper } from '../../../cursor/content-offsets';
	import {
		rawOffsetAtNode,
		rawTextOfNode,
		containerRawLength,
		createRangeAtRawOffsets
	} from '../../../cursor/widget-offset';
	import { createAmbientCursorIO } from '../../../ambient/ambient-cursor';
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
	import { createCrossBlockHandlers } from '../../../selection/cross-block/dispatch';
	import {
		writeCrossBlockCopy,
		writeCrossBlockCut
	} from '../../../selection/cross-block/clipboard';
	import { resetForPointerDown } from '../../../selection/cross-block/pointer';
	import { publishRefSlot } from '../../../reactivity/publish-ref.svelte';
	import { selectWholeDocument } from '../../../selection/keyboard-extend';
	import { cellKeydownPlan, type CellKeyPlan } from './cell-keydown-plan';
	import { intraTableRectPayload } from './cell-clipboard';
	import {
		installCellDragListener,
		handleCellShiftClick,
		cellCoordsOfElement,
		type CellAnchor
	} from './cell-pointer';
	import { createCellRender } from './cell-render';

	type ExitDirection = 'up' | 'down';

	let {
		node,
		index,
		myPath = [],
		rowIdx,
		colIdx,
		columnCount,
		rowCount,
		alignment = 'none',
		setRef,
		getRef
	}: {
		node: CstNode;
		index: number;
		myPath?: number[];
		rowIdx: number;
		colIdx: number;
		columnCount: number;
		rowCount: number;
		alignment?: TableAlignment;
		setRef?: (i: number, r: BlockComponent | undefined) => void;
		getRef?: (i: number) => BlockComponent | undefined;
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
	const linkRef = getContext<LinkReferenceResolverRef | undefined>(LINK_REF_KEY);

	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	let pendingCursorOffset = $state<number | null>(null);
	let preEditOffset = 0;

	// Cells carry no ambient marker; at zero ambient the factory is plain
	// widget-aware raw-unit cursor IO (textContent math undercounts widget bytes).
	const cursor = createAmbientCursorIO({
		getEl: () => el ?? null,
		getAmbientLength: () => 0
	});

	const crossBlock = createCrossBlockHandlers({
		getEl: () => el ?? null,
		getMyPath: () => myPath,
		getIndex: () => index,
		selection,
		getDoc,
		getBlockElByPath,
		revealPath: focusActions.revealPath,
		getEditorRoot,
		getEditorLifetime: () => editorLifetime ?? null,
		stickyColumn,
		containerEdit,
		blockEdit,
		controller,
		history,
		pasteCoordinator,
		getCursorOffset: () => cursor.getRaw(),
		afterReactivity: () => tick(),
		setPendingCursor: (offset) => {
			pendingCursorOffset = offset;
		}
	});

	const sharedCtx: SharedKeydownContext = {
		getEl: () => el ?? null,
		getCursorOffset: () => cursor.getRaw(),
		getFocusOffset: () => getRawFocusOffset(),
		getTextLen: () => (el ? containerRawLength(el) : 0),
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
		cursor.setRaw(Math.max(0, offset));
	}

	export function focusAtColumn(x: number, from: StickyColumnDirection): void {
		if (!el) return;
		el.focus();
		cursor.setRaw(findOffsetNearestX(el, x, from));
	}

	export function getCursorOffset(): number | null {
		return cursor.getRaw();
	}

	export function getSelectedText(): string {
		return window.getSelection()?.toString() ?? '';
	}

	export function setSelection(start: number, end: number): void {
		if (!el) return;
		const range = createRangeAtRawOffsets(el, start, end);
		if (!range) return;
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	export function measurePartialRects(startOffset: number, endOffset: number): DOMRect[] {
		if (!el) return [];
		return measurePartialRectsInContentEditable(el, startOffset, endOffset);
	}

	function toggleFormat(format: 'strong' | 'emphasis'): boolean {
		if (!el) return false;
		const offsets = cursor.getRawSelection();
		if (!offsets) return false;
		const result = toggleInlineFormat(readCellText(), offsets, format);
		blockEdit.updateBlockContent(index, result.newDisplay, preEditOffset, result.newSelStart);
		tick().then(() => setSelection(result.newSelStart, result.newSelEnd));
		return true;
	}

	// Cross-block dispatch entry (IMPL-7): a post-delete Enter/Tab routed to this
	// focused cell. There's no live event, so the 'native'/'select-all-step' plans
	// (which extend or delegate an event) are declined; the action plans run.
	export function runCommand(id: CommandId): boolean {
		if (!el) return false;
		if (id === 'format.toggleStrong') return toggleFormat('strong');
		if (id === 'format.toggleEmphasis') return toggleFormat('emphasis');
		if (id !== 'cell.enter' && id !== 'cell.tab' && id !== 'cell.shiftTab') return false;
		const plan = cellKeydownPlan(
			{
				key: id === 'cell.enter' ? 'Enter' : 'Tab',
				ctrlOrMeta: false,
				shiftKey: id === 'cell.shiftTab',
				altKey: false
			},
			{
				rowIdx,
				colIdx,
				columnCount,
				rowCount,
				offset: cursor.getRaw() ?? 0,
				textLen: containerRawLength(el),
				collapsed: !hasSelectionHelper(),
				selectAllCount: selection.selectAllCount
			}
		);
		if (plan.kind === 'native' || plan.kind === 'select-all-step') return false;
		void applyCellPlan(plan);
		return true;
	}

	void ({ editable, focusable, focus, getCursorOffset, focusAtColumn } satisfies BlockComponent);

	$effect(() => {
		if (!setRef || !getRef) return;
		const self: BlockComponent = {
			editable,
			focusable,
			focus,
			getCursorOffset,
			focusAtColumn,
			getSelectedText,
			setSelection,
			measurePartialRects,
			runCommand
		};
		return publishRefSlot(index, self, setRef, getRef);
	});

	// ── Render pipeline ────────────────────────────────────────────────────

	const cellRender = createCellRender({
		get el() {
			return el ?? null;
		},
		get node() {
			return node;
		},
		get linkRef() {
			return linkRef;
		}
	});

	$effect(() => {
		if (!el) return;
		cellRender.render({ forceRebuild: pendingCursorOffset !== null });
		if (pendingCursorOffset !== null) {
			cursor.setRaw(pendingCursorOffset);
			pendingCursorOffset = null;
		}
	});

	// Walk children rather than reading textContent: a rendered widget (e.g. the
	// <br> br-widget) carries zero textContent but several raw bytes, so
	// textContent would undercount and misplace boundary-nav / insert offsets.
	function readCellText(): string {
		if (!el) return '';
		let out = '';
		for (const child of Array.from(el.childNodes)) {
			out += rawTextOfNode(child, node.raw);
		}
		return out;
	}

	function getRawFocusOffset(): number | null {
		if (!el) return null;
		const sel = window.getSelection();
		if (!sel || sel.focusNode === null || !el.contains(sel.focusNode)) return null;
		return rawOffsetAtNode(el, sel.focusNode, sel.focusOffset);
	}

	// ── Event handlers ─────────────────────────────────────────────────────

	function onInput(): void {
		stickyColumn.reset();
		if (composing || !el) return;
		const text = readCellText();
		const savedOffset = cursor.getRaw() ?? 0;
		blockEdit.updateBlockContent(index, text, preEditOffset, savedOffset);
		pendingCursorOffset = savedOffset;
	}

	function onCompositionStart(): void {
		if (!el) return;
		preEditOffset = cursor.getRaw() ?? 0;
		crossBlock.handleCompositionStart();
		composing = true;
	}

	function onCompositionEnd(): void {
		composing = false;
		onInput();
	}

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing || !el) return;

		// Cross-block dispatch must precede cellKeydownPlan: the plan claims keys like
		// ArrowLeft@0 / ArrowUp / ArrowDown and preventDefaults without reaching the
		// cross-block handler, so an active selection would survive and the next
		// keystroke would range-replace the whole table. Gated on isCrossBlock so the
		// common cell path and the 3-stage Ctrl+A (stages 1-2 run not-cross-block) are
		// untouched.
		if (selection.isCrossBlock && (await crossBlock.handleKeyDown(e))) return;

		preEditOffset = cursor.getRaw() ?? 0;
		const plan = cellKeydownPlan(
			{ key: e.key, ctrlOrMeta: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey },
			{
				rowIdx,
				colIdx,
				columnCount,
				rowCount,
				offset: preEditOffset,
				textLen: containerRawLength(el),
				collapsed: !hasSelectionHelper(),
				selectAllCount: selection.selectAllCount
			}
		);

		switch (plan.kind) {
			case 'native': {
				if (await handleSharedKeydown(e, sharedCtx)) return;
				// Cells route navigation through cellKeydownPlan, but inline-format
				// chords (Mod+B/Mod+I) still dispatch through the keymap like every
				// other editable surface.
				const chord = eventToChord(e);
				if (chord && dispatchKeyCommand(chord, { kind: node.kind, runCommand }, { history })) {
					e.preventDefault();
					return;
				}
				return;
			}
			// Cells override the document-level 2-stage Ctrl+A with a 3-stage
			// table-aware variant; the intra-cell step stays native (no preventDefault).
			case 'select-all-step':
				selection.incrementSelectAllCount();
				if (plan.step === 'native') return;
				e.preventDefault();
				if (plan.step === 'table') {
					const tablePath = myPath.slice(0, -2);
					selection.enterCrossBlock(
						{ path: tablePath, offset: 0 },
						{ path: tablePath, offset: columnCount * rowCount - 1 }
					);
				} else {
					selectWholeDocument(selection, getDoc(), getBlockElByPath);
				}
				return;
			default:
				e.preventDefault();
				await applyCellPlan(plan);
				return;
		}
	}

	// The action plans (no live event needed). Shared by onKeyDown's default arm
	// and runCommand's cross-block dispatch; the caller preventDefaults.
	async function applyCellPlan(plan: CellKeyPlan): Promise<void> {
		switch (plan.kind) {
			case 'shortcut':
				await tableContext[plan.action](plan.arg);
				return;
			case 'focus-cell':
				if (plan.setStickyColumn !== undefined) tableContext.setStickyColumn(plan.setStickyColumn);
				tableContext.focusCell(plan.rowIdx, plan.colIdx, plan.position);
				return;
			case 'insert-row-below':
				await tableContext.insertRowBelow(rowIdx);
				return;
			case 'exit':
				exitWithStickyX(plan.direction);
				return;
		}
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
			// GFM cells can't carry raw newlines, so the proper representation is
			// a literal <br>. The inline-HTML pipeline renders <br> as a live
			// widget producing a visible line break inside the cell.
			e.preventDefault();
			if (!el) return;
			const offset = cursor.getRaw() ?? 0;
			const text = readCellText();
			const inserted = '<br>';
			const newText = text.slice(0, offset) + inserted + text.slice(offset);
			blockEdit.updateBlockContent(index, newText, offset, offset + inserted.length);
			pendingCursorOffset = offset + inserted.length;
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
		installCellDragListener({ editorRoot, selection, lifetimeSignal: editorLifetime }, anchor);
	}

	function onCopy(e: ClipboardEvent): void {
		stickyColumn.reset();
		const rectPayload = intraTableRectPayload({ selection, getDoc });
		if (rectPayload !== null) {
			e.preventDefault();
			e.clipboardData?.setData('text/plain', rectPayload);
			return;
		}

		writeCrossBlockCopy(e, { selection, getDoc, crossBlock });
	}

	async function onCut(e: ClipboardEvent): Promise<void> {
		stickyColumn.reset();
		e.preventDefault();

		// Intra-table multi-cell rectangle: write a GFM sub-table, then route the
		// delete through the cross-block path *without* tableCoverageDelete so
		// the cells are cleared in place (Backspace's structural delete is the
		// only path that opts into row/column/table removal).
		const rectPayload = intraTableRectPayload({ selection, getDoc });
		if (rectPayload !== null) {
			e.clipboardData?.setData('text/plain', rectPayload);
			await crossBlock.performCrossBlockDeleteFromEvent();
			return;
		}

		if (await writeCrossBlockCut(e, { selection, getDoc, crossBlock })) return;

		// Intra-cell: slice node.raw at the selection, write the slice, and
		// commit the truncation through blockEdit so the CST and undo stack
		// stay in step. The native deleteByCut path would mutate the DOM
		// out from under the CST and leave a stale snapshot anchor.
		if (!el) return;
		const offsets = cursor.getRawSelection();
		if (!offsets || offsets.start === offsets.end) return;
		const display = trimTrailingLineEnding(node.raw);
		e.clipboardData?.setData('text/plain', display.slice(offsets.start, offsets.end));
		const newDisplay = display.slice(0, offsets.start) + display.slice(offsets.end);
		blockEdit.updateBlockContent(index, newDisplay, offsets.start, offsets.start);
		pendingCursorOffset = offsets.start;
	}

	async function onPaste(e: ClipboardEvent): Promise<void> {
		if (await crossBlock.handlePaste(e)) return;

		stickyColumn.reset();
		if (!el) return;
		e.preventDefault();
		const pastedText = normalizeLineEndings(e.clipboardData?.getData('text/plain') ?? '');
		if (!pastedText) return;

		const selOffsets = cursor.getRawSelection();
		const offset = selOffsets ? selOffsets.start : (cursor.getRaw() ?? 0);

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
	style:text-align={alignment === 'none' ? undefined : alignment}
	oninput={onInput}
	onkeydown={onKeyDown}
	onbeforeinput={onBeforeInput}
	onpointerdown={onPointerDown}
	oncopy={onCopy}
	oncut={onCut}
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
		border: 1px solid var(--color-ui-muted, #a4a4a4);
	}
	.table-cell:focus {
		outline: 2px solid var(--color-accent, #567b67);
		outline-offset: -2px;
	}
</style>
