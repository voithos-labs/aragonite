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
	import { publishRefSlot } from '../../../reactivity/publish-ref.svelte';
	import {
		selectWholeDocument,
		extendFocusToNextBlock,
		extendFocusToPreviousBlock
	} from '../../../selection/keyboard-extend';
	import { intraTableRectExtension } from '../../../selection/table-rect-extend';
	import { isAtFirstVisualLine, isAtLastVisualLine } from '../../../cursor/visual-lines';
	import { cellKeydownPlan, type CellKeyPlan, type CellKeyState } from './cell-keydown-plan';
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

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const tableContext = getContext<TableContext>(TABLE_CONTEXT_KEY);
	const {
		controller,
		pasteCoordinator,
		stickyColumn,
		selection,
		widgetSelection,
		registryView,
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
		editorRoot: getEditorRoot,
		scrollHost: getScrollHost,
		lifetime: editorLifetime,
		pluginEditor,
		linkRef
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const readOnly = $derived(getPresentationMode?.() === 'reading');
	const onCommandError: CommandErrorSink = (report) => emitCommandError(editorEvents, report);

	// The constant fallback keeps the zero-cost render path — an empty island set
	// never enters the render key.
	const NO_ISLANDS: IndexedDecoration<WidgetDecoration | ReplaceDecoration>[] = [];

	// ── The cell's write door ───────────────────────────────────────────────
	//
	// Every write of this cell's raw goes through `blockEdit`; `parentBlockEdit`
	// is written to nowhere else. The delimiter escape itself belongs to the kind
	// (`normalizeRawWrite`) and runs at the write sink, so what remains here is the
	// caret half a seam cannot do for us: the offset a caller hands back addresses
	// the text it wrote, and the sink's inserted backslashes move it. `parkCursor`
	// below is the same rule's second door, for the caret writes that never pass
	// through this one.
	//
	// A trailing ending is stripped rather than left to the sink's collapse: the
	// prose-shaped reveal / caret-edge / selected-widget factories append one, and
	// a cell would otherwise gain a trailing space per commit.
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
	// True while an inline-widget's `$…$` source is revealed for editing: the edit
	// is ephemeral DOM, so onInput skips the per-keystroke CST commit — the cell
	// commits once on reveal exit (mirrors TextEditableBlock).
	let revealing = $state(false);
	let pendingCursorOffset = $state<number | null>(null);

	// The door's other half, and the ONLY write of `pendingCursorOffset` besides the
	// render effect's clear. A pending cursor never passes through `blockEdit`, so
	// its caller hands over the text the offset addresses and the mapping happens
	// here. No text means the offset already stands in escaped space or the write
	// left every byte before it alone.
	function parkCursor(offset: number | null, writtenText?: string): void {
		pendingCursorOffset =
			offset === null || writtenText === undefined
				? offset
				: escapedCellOffset(writtenText, offset);
	}

	let preEditOffset = 0;
	// Click point captured in pointerdown; Y is load-bearing for the reveal
	// hit-test — a column-aligned click on another visual line must not reveal.
	let lastClickClientX: number | null = null;
	let lastClickClientY: number | null = null;

	// Cells carry no ambient marker; at zero ambient the factory is plain
	// widget-aware raw-unit cursor IO (textContent math undercounts widget bytes).
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
		blockEdit,
		controller,
		history,
		pluginEditor,
		getPresentationMode,
		onCommandError,
		getKeybindingOverrides: keybindingOverrides,
		pasteCoordinator,
		grammar: registryView.grammar,
		getFocusOffset: () => getRawFocusOffset(),
		getTextLen: () => (el ? containerDomTextLength(el) : 0),
		readText: () => readCellText(),
		// The keystroke/IME commit; `savedOffset` re-focuses if the edit remounts
		// the cell, so it is reported through the door's escape.
		commitInput: (text, preEdit, saved) => {
			void blockEdit.updateBlockContent(index, text, preEdit, saved);
			return escapedCellOffset(text, saved);
		}
	});

	const crossBlock = editableSurface.crossBlock;
	const sharedCtx = editableSurface.sharedCtx;

	// The prose inline-widget seams, threaded with cell-shaped deps: zero ambient,
	// no snap overlay (cells render no image widgets), and the escaping blockEdit.
	// Reveal targets the widget kinds cells render as widgets — inline math and
	// inline directives opt into `revealSource`; a `<br>` is selected instead.
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

	// The one caret-edge dispatch: a plain edge key against a CST widget, a
	// decoration island, or (n/a for a zero-ambient cell) an ambient marker resolves
	// against its declarative policy — reveal entry for math/directives, edge
	// select-then-delete for replace islands. Same seam prose uses.
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
		// Reveal-capable kinds (math, directive) reveal their source; a non-reveal CST
		// widget in a cell is only `<br>` (images render as alt text here), and the
		// prose image model — select whole, second press deletes — has no cell
		// affordance and strands focus, so step the caret over it like native
		// contenteditable instead. `fromTrailingEdge` is the entry side.
		enterWidget: (widget, fromTrailingEdge) => {
			if (getInlineWidgetEditing(widget.kind)?.revealSource) {
				widgetInteraction.enterWidget(widget, fromTrailingEdge);
			} else {
				cursor.setRaw(asRawOffset(fromTrailingEdge ? widget.start : widget.end));
			}
		},
		isReading: () => readOnly
	});

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
		void blockEdit.updateBlockContent(
			index,
			result.newDisplay,
			result.newSelStart,
			result.newSelStart
		);
		// The door may have inserted backslashes inside the toggled span (wrapping
		// `**` can strand a `|` the preceding backslash used to escape), so both
		// selection edges are read back through the escape.
		const selStart = escapedCellOffset(result.newDisplay, result.newSelStart);
		const selEnd = escapedCellOffset(result.newDisplay, result.newSelEnd);
		void tick().then(() => setSelection(selStart, selEnd));
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
			cellPlanState(cursor.getRaw() ?? 0)
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
		getDocument: () => getDoc(),
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

	// While source is revealed, a caret/selection move that leaves the source but
	// stays inside the cell folds the reveal (blur owns the focus-leaving fold; a
	// cross-block sweep keeps it revealed). Composition suppresses it like onInput.
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

	// The keydown-plan input for this cell at a given caret offset. Shared by the
	// live keydown path and the cross-block dispatch entry, which differ only in
	// where the offset comes from; both guard `el` before calling.
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

		// The select-all stage counter's reset lives in the shared prelude, which the
		// cell reaches only on the 'native' plan arm — so every key the plan claims
		// (cell nav, Tab, Enter, the structural chords) left the counter armed and the
		// next Ctrl+A resumed a run the user had ended: in the next cell it selected
		// the whole table, and after an arrow exit it selected the whole document from
		// a paragraph's first press. Reset here, ahead of the plan, in the prelude's
		// own position. `eventToChord` declines exactly the bare modifiers, which are
		// part of the chord rather than a separate action, and uppercases the key, so
		// the run also survives CapsLock.
		const chord = eventToChord(e);
		if (chord !== null && chord !== SELECT_ALL_CHORD) selection.resetSelectAllCount();

		// Cross-block dispatch must precede cellKeydownPlan: the plan claims keys like
		// ArrowLeft@0 / ArrowUp / ArrowDown and preventDefaults without reaching the
		// cross-block handler, so an active selection would survive and the next
		// keystroke would range-replace the whole table. Gated on isCrossBlock so the
		// common cell path and the 3-stage Ctrl+A (stages 1-2 run not-cross-block) are
		// untouched.
		if (selection.isCrossBlock && (await crossBlock.handleKeyDown(e))) return;

		// Inline-widget reveal/selection intercepts before the cell plan claims the
		// key: while source is revealed Escape cancels and every other key edits the
		// source natively (onInput suppressed); a selected widget and a Shift+Arrow
		// into a widget own their keys too. cellKeydownPlan would otherwise treat
		// ArrowUp/Down as cell nav mid-reveal.
		if (await widgetInteraction.handleRevealingKeydown(e)) return;
		// Enter is the exception a cell carries rather than inherits. In a prose block
		// Enter splits, so it routes through the command seam, which folds the reveal
		// and then splits. A cell has no split: Enter there is a row hop, and hopping
		// would carry the ephemeral edit out of the surface that owns it. So a cell's
		// Enter commits the reveal and stays put.
		if (widgetInteraction.isRevealing() && e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			widgetInteraction.foldRevealBeforeMutation();
			return;
		}
		if (await widgetInteraction.handleSelectedWidgetKeydown(e)) return;
		if (widgetInteraction.handleShiftArrowIntoWidget(e)) return;

		preEditOffset = cursor.getRaw() ?? 0;
		const plan = cellKeydownPlan(
			{ key: e.key, ctrlOrMeta: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey },
			cellPlanState(preEditOffset)
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
				// A plain edge key against a caret-adjacent CST widget or decoration
				// island: reveal entry for math/directives, edge select-then-delete for a
				// replace island. Runs where cellKeydownPlan yields 'native' — at the cell
				// text boundaries it claims (offset 0 / textLen) the entered widget sits
				// outside the boundary, so the dispatch declines and cell nav proceeds.
				if (edgeDispatch.handleKeydown(e, cursor.getRaw())) return;
				// Cells route navigation through cellKeydownPlan, but inline-format
				// chords (Mod+B/Mod+I) still dispatch through the keymap like every
				// other editable surface.
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
			const caret = offset + inserted.length;
			void blockEdit.updateBlockContent(index, newText, offset, caret);
			parkCursor(caret, newText);
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
		// Capture the click point for onClick's widget-edge reveal/snap (Y is
		// load-bearing for the reveal hit-test's visual-line disambiguation).
		lastClickClientX = e.clientX;
		lastClickClientY = e.clientY;
		// A press on a reveal-source widget is an owned gesture: suppress the browser
		// caret default and skip the cell-selection drag so nothing races the reveal's
		// own placement; onClick dispatches the reveal from the captured point.
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
		installCellDragListener({ editorRoot, selection, lifetimeSignal: editorLifetime }, anchor, e);
	}

	// A cell's copy/cut/paste through the shared skeleton. The cell's extra arms are
	// the intra-table rectangle (a GFM sub-table copied/cut across cells) and the
	// intra-cell raw slice, which preserves widget bytes like <br> that the browser's
	// rendered-textContent copy drops. Copy leaves an empty selection to native (no
	// top-level preventDefault); cut/paste fold a live inline-source reveal first.
	const { onCopy, onCut, onPaste } = createClipboardHandlers({
		stickyColumn,
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
		// During a reveal the swapped DOM holds an uncommitted edit node.raw hasn't
		// seen, so slice the live cell text — copy never mutates, so it reads the live
		// DOM rather than folding first.
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
		// Intra-table rectangle cut: write the sub-table, then clear the cells in place
		// via the cross-block delete *without* tableCoverageDelete (only Backspace's
		// structural delete opts into row/column/table removal).
		cutPreHook: async (e) => {
			const rectPayload = intraTableRectPayload({ selection, getDoc });
			if (rectPayload === null) return false;
			e.clipboardData?.setData('text/plain', rectPayload);
			await crossBlock.performCrossBlockDeleteFromEvent();
			return true;
		},
		// Sync raw-slice write (clipboardData closes after the event), then truncate via
		// deleteCellRange — the native deleteByCut would mutate the DOM out from under
		// the CST and leave a stale snapshot anchor.
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
		// Already escaped: the cell's paste surface reports its caret in escaped space
		// because the sink escapes the whole spliced raw, not just the pasted run.
		if (result.inlineCaretOffset !== undefined) parkCursor(result.inlineCaretOffset);
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

	// Click past a widget drops the caret at an element-level position with no text
	// anchor; snap to the nearest widget edge, or open a reveal when the click landed
	// on a reveal-source widget. The captured pointerdown point carries the Y the
	// hit-test needs; normal text clicks fall through untouched (native caret).
	function onClick(): void {
		const x = lastClickClientX;
		const y = lastClickClientY;
		lastClickClientX = null;
		lastClickClientY = null;
		widgetInteraction.snapClickToWidgetEdge(x, y);
	}

	function onFocus(): void {
		tableContext.notifyCellFocused(rowIdx, colIdx);
	}

	function onBlur(e: FocusEvent): void {
		// Focus left the cell with source still revealed — persist the edit before the
		// caret is gone (the render effect's activeElement guard drops the caret
		// restore, so the commit doesn't yank focus back). A focus move that stays
		// inside the cell keeps the reveal open.
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
