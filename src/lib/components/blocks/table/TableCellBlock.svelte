<script lang="ts">
	import { getContext, tick } from 'svelte';
	import type {
		BlockEditActions,
		ContainerEditActions,
		FocusActions,
		HistoryActions,
		TableContext
	} from '../../../action-contracts';
	import { type BlockComponent } from '../../../block-component';
	import { type CommandId } from '../../../schema/commands';
	import { dispatchKeyCommand, type CommandErrorSink } from '../../../schema/block-commands';
	import { eventToChord } from '../../../schema/keybindings';
	import { toggleInlineFormat } from '../text/format-toggle';
	import type { NodeView } from '../../../core/node-views';
	import { emitCommandError } from '../../../editor-events';
	import {
		BLOCK_EDIT_KEY,
		CONTAINER_EDIT_KEY,
		EDITOR_DOC_KEY,
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		TABLE_CONTEXT_KEY,
		type EditorDoc,
		type EditorPolicies,
		type EditorServices
	} from '../../../editor-keys';
	import type { TableAlignment } from '../../../core/nodes';
	import { trimTrailingLineEnding, normalizeLineEndings } from '../../../core/lines';
	import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
	import { hasSelection as hasSelectionHelper } from '../../../cursor/content-offsets';
	import {
		domTextOffsetAtNode,
		rawTextOfNode,
		containerDomTextLength,
		createRangeAtDomTextOffsets
	} from '../../../cursor/widget-offset';
	import { asRawOffset, toDomTextOffset, type RawOffset } from '../../../cursor/coordinate-spaces';
	import { createAmbientCursorIO } from '../../../ambient/ambient-cursor';
	import { getCurrentCursorEditorRelativeX } from '../../../cursor/sticky-measure';
	import { handleSharedKeydown, handleSharedBeforeInput } from '../../../selection/shared-keydown';
	import { createEditableSurface } from '../editable-surface';
	import { parkFocusOnEditorRoot } from '../../../selection/native-bridge';
	import {
		writeCrossBlockCopy,
		writeCrossBlockCut
	} from '../../../selection/cross-block/clipboard';
	import { resetForPointerDown } from '../../../selection/cross-block/pointer';
	import { publishRefSlot } from '../../../reactivity/publish-ref.svelte';
	import {
		selectWholeDocument,
		extendFocusToNextBlock,
		extendFocusToPreviousBlock
	} from '../../../selection/keyboard-extend';
	import { intraTableRectExtension } from '../../../selection/table-rect-extend';
	import { isAtFirstVisualLine, isAtLastVisualLine } from '../../../cursor/visual-lines';
	import { cellKeydownPlan, type CellKeyPlan } from './cell-keydown-plan';
	import { intraTableRectPayload } from './cell-clipboard';
	import { escapeCellCommit } from './table-cell-paste';
	import type { CellSelectionPoint, SelectionPoint } from '../../../selection/primitives';
	import type { ClipboardAction } from './table-menu-model';
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
		node: NodeView;
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
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const containerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const tableContext = getContext<TableContext>(TABLE_CONTEXT_KEY);
	const {
		controller,
		pasteCoordinator,
		stickyColumn,
		selection,
		events: editorEvents
	} = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const {
		keybindingOverrides,
		presentationMode: getPresentationMode,
		resolveLinkUrl
	} = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const {
		blockElLookup: getBlockElByPath,
		doc: getDoc,
		editorRoot: getEditorRoot,
		lifetime: editorLifetime,
		pluginEditor,
		linkRef
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const readOnly = $derived(getPresentationMode?.() === 'reading');
	const onCommandError: CommandErrorSink = (report) => emitCommandError(editorEvents, report);

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

	const editableSurface = createEditableSurface({
		getEl: () => el ?? null,
		getAmbientLength: () => 0,
		backend: {
			getRaw: () => cursor.getRaw(),
			setRaw: (offset) => cursor.setRaw(offset),
			buildRange: (start, end) =>
				createRangeAtDomTextOffsets(el!, toDomTextOffset(start, 0), toDomTextOffset(end, 0))
		},
		getMyPath: () => myPath,
		getIndex: () => index,
		getComposing: () => composing,
		setComposing: (value) => {
			composing = value;
		},
		getPreEditOffset: () => preEditOffset,
		setPreEditOffset: (offset) => {
			preEditOffset = offset;
		},
		setPendingCursor: (offset) => {
			pendingCursorOffset = offset;
		},
		selection,
		getDoc,
		getBlockElByPath,
		focusActions,
		getEditorRoot,
		getEditorLifetime: () => editorLifetime ?? null,
		stickyColumn,
		containerEdit,
		blockEdit,
		controller,
		history,
		pluginEditor,
		getPresentationMode,
		onCommandError,
		getKeybindingOverrides: keybindingOverrides,
		pasteCoordinator,
		getFocusOffset: () => getRawFocusOffset(),
		getTextLen: () => (el ? containerDomTextLength(el) : 0),
		readText: () => readCellText(),
		// Cells can't carry a raw newline, so no trailing '\n' (unlike text/code);
		// savedOffset re-focuses if the edit remounts the cell. Escape typed/IME
		// pipes to `\|` — the same bytes a paste writes — so a bare `|` never splits
		// the row on reparse; the returned caret shifts past the inserted backslash.
		commitInput: (text, preEdit, saved) => {
			const committed = escapeCellCommit(text, saved);
			void blockEdit.updateBlockContent(index, committed.text, preEdit, committed.caret);
			return committed.caret;
		}
	});

	const crossBlock = editableSurface.crossBlock;
	const sharedCtx = editableSurface.sharedCtx;

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export const focus = editableSurface.surface.focus;
	export const focusAtColumn = editableSurface.surface.focusAtColumn;
	export const getCursorOffset = editableSurface.surface.getCursorOffset;
	export const getSelectedText = editableSurface.surface.getSelectedText;
	export const setSelection = editableSurface.surface.setSelection;
	export const measurePartialRects = editableSurface.surface.measurePartialRects;

	function toggleFormat(format: 'strong' | 'emphasis'): boolean {
		if (!el) return false;
		const offsets = cursor.getRawSelection();
		if (!offsets) return false;
		const result = toggleInlineFormat(readCellText(), offsets, format);
		// Anchor undo at the live post-toggle caret, not preEditOffset: cross-block
		// dispatch reaches toggleFormat via runCommand with no preceding onKeyDown to
		// refresh preEditOffset, so it would be stale. Mirrors TextEditableBlock.
		blockEdit.updateBlockContent(index, result.newDisplay, result.newSelStart, result.newSelStart);
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
				textLen: containerDomTextLength(el),
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
			runCommand,
			getSelectionOffsets,
			applyMenuClipboard
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
		},
		resolveLinkUrl,
		reportRenderError: (error) =>
			editorEvents?.emit('error', { origin: 'render', error, context: { path: myPath } })
	});

	$effect(() => {
		if (!el) return;
		cellRender.render({ forceRebuild: pendingCursorOffset !== null });
		if (pendingCursorOffset !== null) {
			// Restore only while this cell still owns focus — an unguarded restore
			// would yank the global selection back into a blurred cell. Mirrors the
			// activeElement guards in TextEditableBlock and CodeBlock.
			if (document.activeElement === el) cursor.setRaw(asRawOffset(pendingCursorOffset));
			pendingCursorOffset = null;
		}
	});

	// Destroy the cell's pooled widget instances on unmount (table teardown / windowing).
	$effect(() => () => cellRender.dispose());

	// Windowed out while focused: hand focus to the editor root so the next
	// keystroke routes through its document-level listener instead of falling to
	// <body>. See parkFocusOnEditorRoot.
	$effect(() => {
		const blockEl = el;
		return () => parkFocusOnEditorRoot(blockEl ?? null, getEditorRoot());
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

	// Zero-ambient cell: the walk offset IS the raw offset, minted across here.
	function getRawFocusOffset(): RawOffset | null {
		if (!el) return null;
		const sel = window.getSelection();
		if (!sel || sel.focusNode === null || !el.contains(sel.focusNode)) return null;
		return asRawOffset(domTextOffsetAtNode(el, sel.focusNode, sel.focusOffset));
	}

	// ── Event handlers ─────────────────────────────────────────────────────

	const onInput = editableSurface.onInput;
	const onCompositionStart = editableSurface.onCompositionStart;
	const onCompositionEnd = editableSurface.onCompositionEnd;

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
				textLen: containerDomTextLength(el),
				collapsed: !hasSelectionHelper(),
				selectAllCount: selection.selectAllCount
			}
		);

		switch (plan.kind) {
			case 'native': {
				// First Shift+ArrowUp/Down at the cell's vertical edge starts an
				// intra-table rectangle down/up a whole row (cell-aware) — the shared
				// prose extend would instead walk the next doc-order leaf (the next cell
				// across, or the table's own first cell). Subsequent presses route
				// through the cross-block handler above.
				if (
					!selection.isCrossBlock &&
					e.shiftKey &&
					!e.altKey &&
					!e.ctrlKey &&
					!e.metaKey &&
					(e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
					startIntraTableRect(e.key, preEditOffset)
				) {
					e.preventDefault();
					return;
				}
				if (await handleSharedKeydown(e, sharedCtx)) return;
				// Cells route navigation through cellKeydownPlan, but inline-format
				// chords (Mod+B/Mod+I) still dispatch through the keymap like every
				// other editable surface.
				const chord = eventToChord(e);
				if (
					chord &&
					dispatchKeyCommand(
						chord,
						{ kind: node.kind, runCommand },
						{ history, pluginEditor, getPresentationMode },
						keybindingOverrides(),
						onCommandError
					)
				) {
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
					// Flag the anchor as a cell coordinate, matching the drag/shift-click
					// anchor: a later exit-the-table extend needs it to snap its whole row.
					selection.enterCrossBlock(
						{ path: tablePath, offset: 0, cellCoordinate: true } satisfies CellSelectionPoint,
						{ path: tablePath, offset: columnCount * rowCount - 1 }
					);
				} else {
					selectWholeDocument(selection, getDoc(), getBlockElByPath);
				}
				return;
			default:
				e.preventDefault();
				// Reading mode keeps cell navigation ('focus-cell'/'exit') and swallows
				// the structural plans (insert/delete/move rows and columns).
				if (readOnly && plan.kind !== 'focus-cell' && plan.kind !== 'exit') return;
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

	// Enter an intra-table rectangle from a collapsed cell caret on the first
	// Shift+ArrowUp/Down. Gated on the cell's visual edge so a multi-line cell still
	// extends its own text first (prose parity). Returns false to fall through.
	function startIntraTableRect(key: 'ArrowUp' | 'ArrowDown', offset: number): boolean {
		if (!el) return false;
		const atEdge =
			key === 'ArrowDown'
				? isAtLastVisualLine(el, offset, containerDomTextLength(el))
				: isAtFirstVisualLine(el, offset);
		if (!atEdge) return false;

		const tablePath = myPath.slice(0, -2);
		const currentIdx = rowIdx * columnCount + colIdx;
		const currentPoint: SelectionPoint = { path: tablePath, offset: currentIdx };
		const ext = intraTableRectExtension(getDoc(), currentPoint, currentPoint, key);
		if (!ext) return false;

		const anchor = {
			path: tablePath,
			offset: currentIdx,
			cellCoordinate: true
		} satisfies CellSelectionPoint;
		if (ext.kind === 'cell') {
			selection.enterCrossBlock(anchor, { path: tablePath.slice(), offset: ext.offset });
			return true;
		}
		// At the vertical edge: enter the rect at the current cell, then hand off to
		// the block-level extend so the selection leaves the table.
		selection.enterCrossBlock(anchor, { path: tablePath.slice(), offset: currentIdx });
		if (ext.direction === 'forward') {
			extendFocusToNextBlock(selection, getDoc(), el, ext.fromCellPath, 'vertical');
		} else {
			extendFocusToPreviousBlock(selection, getDoc(), el, ext.fromCellPath, 'start');
		}
		return true;
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
		// A right-click opens the cell menu; preserve any active intra-table
		// rectangle (encoded as cross-block selection) so the menu's Cut/Copy can
		// act on it. The clear + drag-install below would collapse it first, before
		// contextmenu fires.
		if (e.button === 2) return;
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
		// Reading mode copies the rendered selection, never a raw slice or a
		// GFM sub-table payload.
		if (readOnly) {
			e.preventDefault();
			e.clipboardData?.setData('text/plain', window.getSelection()?.toString() ?? '');
			return;
		}
		const rectPayload = intraTableRectPayload({ selection, getDoc });
		if (rectPayload !== null) {
			e.preventDefault();
			e.clipboardData?.setData('text/plain', rectPayload);
			return;
		}

		if (writeCrossBlockCopy(e, { selection, getDoc, crossBlock })) return;

		// Intra-cell: write the raw slice (preserves widget bytes like <br> that the
		// browser's rendered-textContent copy drops). Mirrors onCut's intra-cell arm,
		// so Copy and Cut write the same payload.
		if (!el) return;
		const offsets = cursor.getRawSelection();
		if (!offsets || offsets.start === offsets.end) return;
		e.preventDefault();
		const display = trimTrailingLineEnding(node.raw);
		e.clipboardData?.setData('text/plain', display.slice(offsets.start, offsets.end));
	}

	async function onCut(e: ClipboardEvent): Promise<void> {
		stickyColumn.reset();
		e.preventDefault();

		// Reading mode: cut degrades to copy (the event still fires on a
		// non-editable surface).
		if (readOnly) {
			onCopy(e);
			return;
		}

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

		// Intra-cell: write the raw slice synchronously (clipboardData closes after
		// the event), then truncate via deleteCellRange. The native deleteByCut path
		// would mutate the DOM out from under the CST and leave a stale snapshot anchor.
		if (!el) return;
		const offsets = cursor.getRawSelection();
		if (!offsets || offsets.start === offsets.end) return;
		const display = trimTrailingLineEnding(node.raw);
		e.clipboardData?.setData('text/plain', display.slice(offsets.start, offsets.end));
		deleteCellRange(offsets.start, offsets.end);
	}

	async function onPaste(e: ClipboardEvent): Promise<void> {
		if (readOnly) {
			e.preventDefault();
			return;
		}
		if (await crossBlock.handlePaste(e)) return;

		stickyColumn.reset();
		if (!el) return;
		e.preventDefault();
		const pastedText = normalizeLineEndings(e.clipboardData?.getData('text/plain') ?? '');
		if (!pastedText) return;

		const selOffsets = cursor.getRawSelection();
		const start = selOffsets ? selOffsets.start : (cursor.getRaw() ?? 0);
		await applyCellPaste(pastedText, { start, end: selOffsets ? selOffsets.end : start });
	}

	// ── Shared mutation primitives (event handlers + right-click menu) ───────

	function deleteCellRange(start: number, end: number): void {
		const display = trimTrailingLineEnding(node.raw);
		const newDisplay = display.slice(0, start) + display.slice(end);
		blockEdit.updateBlockContent(index, newDisplay, start, start);
		pendingCursorOffset = start;
	}

	async function applyCellPaste(
		pastedText: string,
		sel: { start: number; end: number }
	): Promise<void> {
		const result = await pasteDispatch(
			{
				pastedText,
				targetPath: myPath,
				offset: sel.start,
				preDelete: sel.start !== sel.end ? { start: sel.start, end: sel.end } : undefined
			},
			{ doc: getDoc(), blockEdit, controller: pasteCoordinator }
		);
		if (result.inlineCaretOffset !== undefined) pendingCursorOffset = result.inlineCaretOffset;
	}

	// ── Right-click menu clipboard (no ClipboardEvent) ──────────────────────
	//
	// Copy/Cut reuse the native copy path: restore the captured range and let
	// execCommand('copy') fire onCopy (sync e.clipboardData write — Tauri-safe,
	// unlike navigator.clipboard.writeText). execCommand('cut') can't be reused —
	// onCut's clipboard write trails an await — so Cut copies then deletes via the
	// shared primitive. Paste has no sync browser equivalent, so it reads through
	// navigator.clipboard.

	function getSelectionOffsets(): { start: number; end: number } | null {
		const range = cursor.getRawSelection();
		if (range) return range;
		const caret = cursor.getRaw();
		return caret === null ? null : { start: caret, end: caret };
	}

	async function applyMenuClipboard(
		action: ClipboardAction,
		sel: { start: number; end: number }
	): Promise<void> {
		if (!el) return;
		// Belt behind TableBlock's menu-open gate: paste and cut mutate.
		if (readOnly && action !== 'copy') return;
		// Clicking the menu item moved focus off the cell, so every branch refocuses
		// it before mutating — copy/cut so execCommand acts on the restored range,
		// paste so the caret lands in a focused cell and typing continues (native).
		if (action === 'paste') {
			stickyColumn.reset();
			el.focus();
			let raw: string;
			try {
				// Fired un-awaited from the menu onclick, so a denied/failed clipboard
				// read would surface as an unhandled rejection; degrade to a no-op.
				raw = await navigator.clipboard.readText();
			} catch {
				return;
			}
			const text = normalizeLineEndings(raw);
			if (text) await applyCellPaste(text, sel);
			return;
		}
		// Intra-table rectangle: no cell-local range to restore. Refocusing the cell
		// keeps the rect live in SelectionState; execCommand('copy') fires onCopy,
		// which writes the rect payload, and cut then clears the rect in place —
		// mirroring the onCopy/onCut rect arms.
		if (intraTableRectPayload({ selection, getDoc }) !== null) {
			stickyColumn.reset();
			el.focus();
			document.execCommand('copy');
			if (action === 'cut') await crossBlock.performCrossBlockDeleteFromEvent();
			return;
		}
		if (sel.start === sel.end) return;
		stickyColumn.reset();
		el.focus();
		setSelection(sel.start, sel.end);
		document.execCommand('copy');
		if (action === 'cut') deleteCellRange(sel.start, sel.end);
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
	contenteditable={readOnly ? 'false' : 'true'}
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
