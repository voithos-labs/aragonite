<script lang="ts">
	import { getContext, tick } from 'svelte';
	import type {
		BlockEditActions,
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
	import { FALLBACK_CONTENT_WIDTH } from '../../../cursor/typography-estimates';
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
	import { createEditableSurface, createClipboardHandlers } from '../editable-surface';
	import { parkFocusOnEditorRoot } from '../../../selection/native-bridge';
	import { resetForPointerDown } from '../../../selection/cross-block/pointer';
	import { publishRefSlot, type RefSlots } from '../../../reactivity/publish-ref.svelte';
	import {
		selectWholeDocument,
		extendFocusToNextBlock,
		extendFocusToPreviousBlock
	} from '../../../selection/keyboard-extend';
	import { intraTableRectExtension } from '../../../selection/table-rect-extend';
	import { isAtFirstVisualLine, isAtLastVisualLine } from '../../../cursor/visual-lines';
	import { cellKeydownPlan, type CellKeyPlan, type CellKeyState } from './cell-keydown-plan';
	import { tableAxisCommand } from './cell-table-commands';
	import { intraTableRectPayload } from './cell-clipboard';
	import { escapedCellOffset } from './table-cell-paste';
	import type { CellSelectionPoint, SelectionPoint } from '../../../selection/primitives';
	import type { ClipboardAction } from './table-menu-model';
	import {
		installCellDragListener,
		handleCellShiftClick,
		cellCoordsOfElement,
		type CellAnchor
	} from './cell-pointer';
	import { createCellRender } from './cell-render';
	import type { IndexedDecoration } from '../../../decorations/buckets';
	import type { ReplaceDecoration, WidgetDecoration } from '../../../decorations/types';
	import { createWidgetInteraction } from '../text/widget-interaction';
	import { createEdgePolicyDispatch } from '../text/edge-policy-dispatch';
	import { createCompositionSeat } from '../text/edge-seat';
	import { resolvedInlineContent } from '../../../core/inline/inline-cache';
	import { widgetElByStart } from '../text/widget-adjacency';
	import { getInlineWidgetEditing } from '../../../core/inline/inline-widgets';

	type ExitDirection = 'up' | 'down';

	// The chord that continues a select-all run rather than ending it.
	const SELECT_ALL_CHORD = 'Mod+A';

	let {
		node,
		index,
		myPath = [],
		rowIdx,
		colIdx,
		columnCount,
		rowCount,
		alignment = 'none',
		slots
	}: {
		node: NodeView;
		index: number;
		myPath?: number[];
		rowIdx: number;
		colIdx: number;
		columnCount: number;
		rowCount: number;
		alignment?: TableAlignment;
		slots?: RefSlots<BlockComponent>;
	} = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const tableContext = getContext<TableContext>(TABLE_CONTEXT_KEY);
	const {
		controller,
		pasteCoordinator,
		stickyColumn,
		edgeAffinity,
		selection,
		widgetSelection,
		registryView,
		reorder,
		events: editorEvents,
		decorations: decorationEngine
	} = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const {
		keybindingOverrides,
		presentationMode: getPresentationMode,
		resolveLinkUrl,
		onPasteImage
	} = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const {
		blockElLookup: getBlockElByPath,
		doc: getDoc,
		contentVersion: getContentVersion,
		editorRoot: getEditorRoot,
		scrollHost: getScrollHost,
		lifetime: editorLifetime,
		pluginEditor,
		linkRef
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const readOnly = $derived(getPresentationMode?.() === 'reading');
	const onCommandError: CommandErrorSink = (report) => emitCommandError(editorEvents, report);

	// A constant fallback keeps an empty island set out of the render key.
	const NO_ISLANDS: IndexedDecoration<WidgetDecoration | ReplaceDecoration>[] = [];

	// ── The cell's write door ───────────────────────────────────────────────
	//
	// Every write of this cell's raw goes through `blockEdit`. The delimiter escape is the
	// kind's (`normalizeRawWrite`, applied at the write sink); what remains here is the
	// caret half no seam can carry — a caller's offset addresses the text it wrote, and
	// the sink's inserted backslashes move it. `parkCursor` is the second door, and the
	// trailing ending is stripped because the prose-shaped factories append one.
	const blockEdit: BlockEditActions = {
		...parentBlockEdit,
		updateBlockContent(i, text, caretBefore, caretAfter) {
			const cellText = trimTrailingLineEnding(text);
			return parentBlockEdit.updateBlockContent(
				i,
				cellText,
				caretBefore,
				caretAfter === undefined ? undefined : escapedCellOffset(cellText, caretAfter)
			);
		}
	};

	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	// A revealed widget source is ephemeral DOM, so onInput skips the per-keystroke CST
	// commit and the cell commits once on reveal exit (mirrors TextEditableBlock).
	let revealing = $state(false);
	let pendingCursorOffset = $state<number | null>(null);

	// The door's other half, and the ONLY write of `pendingCursorOffset` besides the render
	// effect's clear. A pending cursor never passes through `blockEdit`, so the caller hands
	// over the text its offset addresses; no text means it already stands in escaped space.
	function parkCursor(offset: number | null, writtenText?: string): void {
		pendingCursorOffset =
			offset === null || writtenText === undefined
				? offset
				: escapedCellOffset(writtenText, offset);
	}

	let preEditOffset = 0;
	// Y is load-bearing for the reveal hit-test: a column-aligned click on another
	// visual line must not reveal.
	let lastClickClientX: number | null = null;
	let lastClickClientY: number | null = null;

	// Cells carry no ambient marker; at zero ambient the factory is plain widget-aware
	// raw-unit cursor IO (textContent math undercounts widget bytes).
	const cursor = createAmbientCursorIO({
		getEl: () => el ?? null,
		getAmbientLength: () => 0
	});

	const editableSurface = createEditableSurface({
		getEl: () => el ?? null,
		getAmbientLength: () => 0,
		isInputSuppressed: () => revealing,
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
		setPendingCursor: (offset) => parkCursor(offset),
		selection,
		getDoc,
		getBlockElByPath,
		focusActions,
		getEditorRoot,
		getScrollHost,
		getEditorLifetime: () => editorLifetime ?? null,
		stickyColumn,
		edgeAffinity,
		blockEdit,
		controller,
		history,
		pluginEditor,
		getPresentationMode,
		onCommandError,
		getKeybindingOverrides: keybindingOverrides,
		pasteCoordinator,
		grammar: registryView.grammar,
		events: editorEvents,
		getFocusOffset: () => getRawFocusOffset(),
		getTextLen: () => (el ? containerDomTextLength(el) : 0),
		readText: () => readCellText(),
		relocateComposedText: (after, composedAt) => compositionSeat.relocate(after, composedAt),
		// `saved` re-focuses if the edit remounts the cell, so it is reported through
		// the door's escape.
		commitInput: (text, preEdit, saved) => {
			void blockEdit.updateBlockContent(index, text, preEdit, saved);
			return escapedCellOffset(text, saved);
		}
	});

	// The same seat the keydown dispatch takes, for the one insertion a keydown cannot reach.
	const compositionSeat = createCompositionSeat({
		getDisplayText: () => trimTrailingLineEnding(node.raw),
		getInlines: () => resolvedInlineContent(node, linkRef),
		getAffinity: () => edgeAffinity.get()
	});

	const crossBlock = editableSurface.crossBlock;
	const sharedCtx = editableSurface.sharedCtx;

	// The prose inline-widget seams, threaded with cell-shaped deps: zero ambient, no
	// snap overlay (cells render no image widgets), and the escaping blockEdit.
	const widgetInteraction = createWidgetInteraction({
		get node() {
			return node;
		},
		get index() {
			return index;
		},
		get myPath() {
			return myPath;
		},
		getEl: () => el ?? null,
		getAmbientLength: () => 0,
		getEditorContentWidth: () => getEditorRoot()?.clientWidth ?? FALLBACK_CONTENT_WIDTH,
		cursor,
		widgetSelection,
		blockEdit,
		focusActions,
		setSnapTarget: () => {},
		setPendingCursor: (offset, writtenText) => parkCursor(offset, writtenText),
		readRawText: () => readCellText(),
		setRevealing: (value) => {
			revealing = value;
		},
		isCrossBlock: () => selection.isCrossBlock,
		getPresentationMode,
		get linkRef() {
			return linkRef;
		}
	});

	// The one caret-edge dispatch (G4.12), same seam prose uses: a plain edge key against
	// a CST widget or a decoration island resolves against its declarative policy.
	const edgeDispatch = createEdgePolicyDispatch({
		get node() {
			return node;
		},
		get index() {
			return index;
		},
		get linkRef() {
			return linkRef;
		},
		getEl: () => el ?? null,
		getAmbientLength: () => 0,
		hasIslands: () =>
			decorationEngine ? decorationEngine.islandsForPath(myPath).length > 0 : false,
		getRawSelection: () => cursor.getRawSelection(),
		blockEdit,
		setPendingCursor: (offset, _source, writtenText) => parkCursor(offset, writtenText),
		setSnapTarget: () => {},
		isRevealing: () => widgetInteraction.isRevealing(),
		// A non-reveal widget reached through this seam is an ARROW's entry, so step the
		// caret over it like native contenteditable.
		enterWidget: (widget, fromTrailingEdge) => {
			if (getInlineWidgetEditing(widget.kind)?.revealSource) {
				widgetInteraction.enterWidget(widget, fromTrailingEdge);
			} else {
				cursor.setRaw(asRawOffset(fromTrailingEdge ? widget.start : widget.end));
			}
		},
		// A cell paints no widget-selection overlay, so the prose select-then-delete default
		// would show nothing between the presses. Scoped to what the cell actually PAINTS as
		// a widget, and merged onto the registered policy rather than replacing it.
		widgetEdgePolicy: (widget) => {
			const registered = getInlineWidgetEditing(widget.kind);
			if (!el || registered?.revealSource) return undefined;
			return widgetElByStart(el, widget.start)
				? { ...registered, deleteGranularity: 'atomic' }
				: undefined;
		},
		isReading: () => readOnly,
		getEdgeAffinity: () => edgeAffinity.get()
	});

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export const focus = editableSurface.surface.focus;
	export const parkCaret = editableSurface.surface.parkCaret;
	export const focusAtColumn = editableSurface.surface.focusAtColumn;
	export const getCursorOffset = editableSurface.surface.getCursorOffset;
	export const getSelectedText = editableSurface.surface.getSelectedText;
	export const setSelection = editableSurface.surface.setSelection;
	export const measurePartialRects = editableSurface.surface.measurePartialRects;

	// Claims the chord even with no caret to act on: declining leaves Mod+B to the browser's
	// own contenteditable bold, an edit this surface never authored.
	function toggleFormat(format: 'strong' | 'emphasis'): boolean {
		if (!el) return true;
		const caret = cursor.getRaw();
		// A collapsed caret is the empty-pair contract, not a bail — see toggleInlineFormat.
		const offsets =
			cursor.getRawSelection() ?? (caret === null ? null : { start: caret, end: caret });
		if (!offsets) return true;
		const result = toggleInlineFormat(readCellText(), offsets, format);
		// Anchor undo at the live post-toggle caret: cross-block dispatch arrives with no
		// preceding onKeyDown, so `preEditOffset` would be stale (mirrors TextEditableBlock).
		void blockEdit.updateBlockContent(
			index,
			result.newDisplay,
			result.newSelStart,
			result.newSelStart
		);
		// The door may have inserted backslashes inside the toggled span, so both selection
		// edges are read back through the escape.
		const selStart = escapedCellOffset(result.newDisplay, result.newSelStart);
		const selEnd = escapedCellOffset(result.newDisplay, result.newSelEnd);
		void tick().then(() => setSelection(selStart, selEnd));
		return true;
	}

	// Every chord the `tableCell` keymap binds arrives here, including from cross-block
	// dispatch, which carries no event — so the 'native'/'select-all-step' plans are
	// declined below and only the action plans run.
	export function runCommand(id: CommandId): boolean {
		if (!el) return false;
		if (id === 'format.toggleStrong') return toggleFormat('strong');
		if (id === 'format.toggleEmphasis') return toggleFormat('emphasis');
		const axisCommand = tableAxisCommand(id);
		if (axisCommand) {
			void tableContext[axisCommand.action](axisCommand.axis === 'row' ? rowIdx : colIdx);
			return true;
		}
		// Moves the whole table: the reorder walk resolves the unit at the nearest ancestor
		// that reorders its children, which a table's grid rows are not.
		if (id === 'block.moveUp' || id === 'block.moveDown') {
			void reorder.nudgeReorderUnit(myPath, id === 'block.moveUp' ? -1 : 1);
			return true;
		}
		if (id !== 'cell.enter' && id !== 'cell.tab' && id !== 'cell.shiftTab') return false;
		const plan = cellKeydownPlan(
			{
				key: id === 'cell.enter' ? 'Enter' : 'Tab',
				ctrlOrMeta: false,
				shiftKey: id === 'cell.shiftTab',
				altKey: false
			},
			cellPlanState(cursor.getRaw() ?? 0)
		);
		if (plan.kind === 'native' || plan.kind === 'select-all-step') return false;
		void applyCellPlan(plan);
		return true;
	}

	void ({
		editable,
		focusable,
		focus,
		parkCaret,
		getCursorOffset,
		focusAtColumn
	} satisfies BlockComponent);

	$effect(() => {
		if (!slots) return;
		const self: BlockComponent = {
			editable,
			focusable,
			focus,
			parkCaret,
			getCursorOffset,
			focusAtColumn,
			getSelectedText,
			setSelection,
			measurePartialRects,
			runCommand,
			getSelectionOffsets,
			applyMenuClipboard,
			snapCaretToPoint
		};
		return publishRefSlot(slots, index, self);
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
		getDocument: () => getDoc(),
		getContentVersion,
		get islands() {
			return decorationEngine ? decorationEngine.islandsForPath(myPath) : NO_ISLANDS;
		},
		reportRenderError: (error) =>
			editorEvents?.emit('error', { origin: 'render', error, context: { path: myPath } })
	});

	$effect(() => {
		if (!el) return;
		cellRender.render({
			forceRebuild: pendingCursorOffset !== null,
			carryCaret: pendingCursorOffset === null
		});
		if (pendingCursorOffset !== null) {
			// Only while this cell still owns focus: an unguarded restore would yank the
			// global selection back into a blurred cell.
			if (document.activeElement === el) cursor.setRaw(asRawOffset(pendingCursorOffset));
			pendingCursorOffset = null;
		}
	});

	$effect(() => () => cellRender.dispose());

	// Windowed out while focused: hand focus to the editor root so the next keystroke
	// routes through its document-level listener instead of falling to `<body>`.
	$effect(() => {
		const blockEl = el;
		return () => parkFocusOnEditorRoot(blockEl ?? null, getEditorRoot());
	});

	// A selection move that leaves a revealed source but stays inside the cell folds the
	// reveal; blur owns the focus-leaving fold. Composition suppresses it like onInput.
	$effect(() => {
		const root = el;
		if (!root) return;
		const handler = () => {
			if (composing) return;
			widgetInteraction.foldRevealIfSelectionEscaped();
		};
		document.addEventListener('selectionchange', handler);
		return () => document.removeEventListener('selectionchange', handler);
	});

	// Walk children rather than reading textContent: a rendered widget carries zero
	// textContent but several raw bytes, so textContent would undercount the offsets.
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
	// Captured before the surface's own handler: its cross-block half clears the affinity, and
	// the first mid-composition `input` re-arms it to the typed side.
	function onCompositionStart(): void {
		compositionSeat.noteStart();
		editableSurface.onCompositionStart();
	}

	function onCompositionEnd(): void {
		editableSurface.onCompositionEnd();
		compositionSeat.noteEnd();
	}

	// Shared by the live keydown path and the cross-block dispatch entry, which differ
	// only in where the offset comes from; both guard `el` before calling.
	function cellPlanState(offset: number): CellKeyState {
		return {
			rowIdx,
			colIdx,
			columnCount,
			rowCount,
			offset,
			textLen: containerDomTextLength(el!),
			collapsed: !hasSelectionHelper(),
			selectAllCount: selection.selectAllCount
		};
	}

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing || !el) return;

		// Ahead of the plan, in the shared prelude's position: the prelude's own reset is
		// reachable only on the 'native' arm, so every key the plan claims would leave the
		// select-all run armed. `eventToChord` declines bare modifiers and uppercases.
		const chord = eventToChord(e);
		if (chord !== null && chord !== SELECT_ALL_CHORD) selection.resetSelectAllCount();

		// Must precede cellKeydownPlan, which claims arrows and preventDefaults without
		// reaching here — leaving a live selection the next keystroke would range-replace.
		if (selection.isCrossBlock && (await crossBlock.handleKeyDown(e))) return;

		// Reveal/selection intercepts before the plan, which would otherwise read a
		// mid-reveal ArrowUp/Down as cell nav.
		if (await widgetInteraction.handleRevealingKeydown(e)) return;
		// Enter is a cell's exception: prose splits, a cell hops rows, and hopping would
		// carry the ephemeral edit out of the surface that owns it. Commit and stay put.
		if (widgetInteraction.isRevealing() && e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			widgetInteraction.foldRevealBeforeMutation();
			return;
		}
		if (await widgetInteraction.handleSelectedWidgetKeydown(e)) return;
		if (widgetInteraction.handleShiftArrowIntoWidget(e)) return;

		preEditOffset = cursor.getRaw() ?? 0;

		// FIRST, because neither the navigation plan's boundary branches nor the shared
		// prelude's ArrowLeft@0 hop tests modifiers: either would eat the column reorder at
		// a cell's left edge. Also the only point a consumer `keybindings` override reaches.
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

		const plan = cellKeydownPlan(
			{ key: e.key, ctrlOrMeta: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey },
			cellPlanState(preEditOffset)
		);

		switch (plan.kind) {
			case 'native': {
				// The first Shift+ArrowUp/Down at a cell's vertical edge takes a whole row;
				// the shared prose extend would instead walk the next doc-order leaf.
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
				// Runs only where the plan yielded 'native': at the text boundaries the plan
				// claims, an entered widget sits outside the boundary and the dispatch declines.
				if (edgeDispatch.handleKeydown(e, cursor.getRaw())) return;
				return;
			}
			// Cells override the document-level 2-stage Ctrl+A with a 3-stage table-aware
			// variant; the intra-cell step stays native.
			case 'select-all-step':
				selection.incrementSelectAllCount();
				if (plan.step === 'native') return;
				e.preventDefault();
				if (plan.step === 'table') {
					const tablePath = myPath.slice(0, -2);
					// Flagged row-major like the drag/shift-click anchor, so a later
					// exit-the-table extend snaps its whole row.
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
				// Reading mode keeps navigation and swallows the structural plans.
				if (readOnly && plan.kind !== 'focus-cell' && plan.kind !== 'exit') return;
				await applyCellPlan(plan);
				return;
		}
	}

	// The navigation plans, no live event needed; the caller preventDefaults.
	async function applyCellPlan(plan: CellKeyPlan): Promise<void> {
		switch (plan.kind) {
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
		// Enter the rect at the current cell, then hand off to the block-level extend so
		// the selection leaves the table.
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
			// GFM cells can't carry raw newlines, so a line break is a literal `<br>`,
			// which the inline-HTML pipeline renders as a live widget.
			e.preventDefault();
			if (!el) return;
			const offset = cursor.getRaw() ?? 0;
			const text = readCellText();
			const inserted = '<br>';
			const newText = text.slice(0, offset) + inserted + text.slice(offset);
			const caret = offset + inserted.length;
			void blockEdit.updateBlockContent(index, newText, offset, caret);
			parkCursor(caret, newText);
			return;
		}
	}

	function onPointerDown(e: PointerEvent): void {
		if (!el) return;
		// The clear + drag-install below would collapse an active rectangle before
		// contextmenu fires, leaving the menu's Cut/Copy nothing to act on.
		if (e.button === 2) return;
		lastClickClientX = e.clientX;
		lastClickClientY = e.clientY;
		// A press on a reveal-source widget is an owned gesture: suppress the browser caret
		// default and skip the drag so nothing races the reveal's own placement.
		if (widgetInteraction.isPointOnRevealWidget(e.clientX, e.clientY)) {
			e.preventDefault();
			return;
		}
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

		resetForPointerDown(selection, stickyColumn, edgeAffinity, e.shiftKey);

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
		installCellDragListener({ editorRoot, selection, lifetimeSignal: editorLifetime }, anchor, e);
	}

	// Copy/cut/paste through the shared skeleton. The cell's extra arms are the intra-table
	// rectangle (copied as a GFM sub-table) and the intra-cell raw slice, which preserves
	// widget bytes like `<br>` that the browser's rendered-textContent copy drops.
	const { onCopy, onCut, onPaste } = createClipboardHandlers({
		stickyColumn,
		edgeAffinity,
		selection,
		getDoc,
		crossBlock,
		isReadOnly: () => readOnly,
		caret: editableSurface.caret,
		events: editorEvents,
		onPasteImage,
		foldReveal: () => widgetInteraction.foldRevealBeforeMutation(),
		copyPreHook: (e) => {
			const rectPayload = intraTableRectPayload({ selection, getDoc });
			if (rectPayload === null) return false;
			e.preventDefault();
			e.clipboardData?.setData('text/plain', rectPayload);
			return true;
		},
		// During a reveal the swapped DOM holds an edit `node.raw` hasn't seen; copy never
		// mutates, so it slices the live DOM text rather than folding first.
		copyTail: (e) => {
			if (!el) return;
			const offsets = cursor.getRawSelection();
			if (!offsets || offsets.start === offsets.end) return;
			e.preventDefault();
			const display = widgetInteraction.isRevealing()
				? readCellText()
				: trimTrailingLineEnding(node.raw);
			e.clipboardData?.setData('text/plain', display.slice(offsets.start, offsets.end));
		},
		// Clears the cells in place, without `tableCoverageDelete` — only Backspace's
		// structural delete opts into row/column/table removal.
		cutPreHook: async (e) => {
			const rectPayload = intraTableRectPayload({ selection, getDoc });
			if (rectPayload === null) return false;
			e.clipboardData?.setData('text/plain', rectPayload);
			await crossBlock.performCrossBlockDeleteFromEvent();
			return true;
		},
		// The write must be sync (clipboardData closes after the event), and the truncation
		// goes through the CST: native deleteByCut would leave a stale snapshot anchor.
		cutTail: (e) => {
			if (!el) return;
			const offsets = cursor.getRawSelection();
			if (!offsets || offsets.start === offsets.end) return;
			const display = trimTrailingLineEnding(node.raw);
			e.clipboardData?.setData('text/plain', display.slice(offsets.start, offsets.end));
			deleteCellRange(offsets.start, offsets.end);
		},
		pasteTail: async (e, pastedText) => {
			if (!el) return;
			const selOffsets = cursor.getRawSelection();
			const start = selOffsets ? selOffsets.start : (cursor.getRaw() ?? 0);
			await applyCellPaste(pastedText, { start, end: selOffsets ? selOffsets.end : start });
		}
	});

	// ── Shared mutation primitives (event handlers + right-click menu) ───────

	function deleteCellRange(start: number, end: number): void {
		const display = trimTrailingLineEnding(node.raw);
		const newDisplay = display.slice(0, start) + display.slice(end);
		void blockEdit.updateBlockContent(index, newDisplay, start, start);
		parkCursor(start, newDisplay);
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
		// Already escaped: the cell's paste surface reports its caret in escaped space.
		if (result.inlineCaretOffset !== undefined) parkCursor(result.inlineCaretOffset);
	}

	// ── Right-click menu clipboard (no ClipboardEvent) ──────────────────────
	//
	// Copy/Cut reuse the native copy path — restoring the range and firing
	// `execCommand('copy')` keeps the clipboard write synchronous, which
	// `navigator.clipboard.writeText` isn't (and Tauri needs). `execCommand('cut')` can't
	// be reused because onCut's write trails an await, so Cut copies then deletes. Paste
	// has no sync equivalent and reads through `navigator.clipboard`.

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
		// Clicking the menu item moved focus off the cell, so every branch refocuses before
		// mutating: execCommand needs the restored range, paste needs a focused caret.
		if (action === 'paste') {
			stickyColumn.reset();
			edgeAffinity.reset();
			el.focus();
			let raw: string;
			try {
				// Fired un-awaited from the menu onclick, so a denied read would surface as
				// an unhandled rejection; degrade to a no-op.
				raw = await navigator.clipboard.readText();
			} catch {
				return;
			}
			const text = normalizeLineEndings(raw);
			if (text) await applyCellPaste(text, sel);
			return;
		}
		// A rectangle has no cell-local range to restore: refocusing keeps it live in
		// SelectionState, and the onCopy/onCut rect arms do the rest.
		if (intraTableRectPayload({ selection, getDoc }) !== null) {
			stickyColumn.reset();
			edgeAffinity.reset();
			el.focus();
			document.execCommand('copy');
			if (action === 'cut') await crossBlock.performCrossBlockDeleteFromEvent();
			return;
		}
		if (sel.start === sel.end) return;
		stickyColumn.reset();
		edgeAffinity.reset();
		el.focus();
		setSelection(sel.start, sel.end);
		document.execCommand('copy');
		if (action === 'cut') deleteCellRange(sel.start, sel.end);
	}

	// A click past a widget drops the caret at an element-level position with no text
	// anchor, so snap to the nearest widget edge (or reveal). Normal text clicks fall
	// through untouched.
	function onClick(): void {
		const x = lastClickClientX;
		const y = lastClickClientY;
		lastClickClientX = null;
		lastClickClientY = null;
		widgetInteraction.snapClickToWidgetEdge(x, y);
	}

	function snapCaretToPoint(clientX: number, clientY: number): void {
		widgetInteraction.snapClickToWidgetEdge(clientX, clientY);
	}

	function onFocus(): void {
		tableContext.notifyCellFocused(rowIdx, colIdx);
	}

	function onBlur(e: FocusEvent): void {
		// Persist a revealed source edit before the caret is gone; the render effect's
		// activeElement guard keeps the commit from yanking focus back.
		if (!(el && e.relatedTarget && el.contains(e.relatedTarget as Node))) {
			widgetInteraction.commitRevealOnBlur();
		}
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
	onclick={onClick}
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
