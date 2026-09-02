<script lang="ts">
	import { getContext, tick } from 'svelte';
	import type { BlockEditActions, TableContext } from '../../../action-contracts';
	import { type BlockComponent } from '../../../block-component';
	import { type CommandId } from '../../../schema/commands';
	import { eventToChord } from '../../../schema/keybindings';
	import {
		createInlineFormatActiveMemo,
		toggleInlineFormat
	} from '../../../core/inline/format-toggle';
	import { paintsFocusedMarkers } from '../../../presentation-mode';
	import {
		inlineMarkForCommand,
		type InlineMarkKind
	} from '../../../schema/inline-construct-policy';
	import type { NodeView } from '../../../core/node-views';
	import {
		EDITOR_DOC_KEY,
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		TABLE_CONTEXT_KEY,
		type EditorDoc,
		type EditorPolicies,
		type EditorServices
	} from '../../../editor-keys';
	import type { TableAlignment } from '../../../core/nodes';
	import { trimTrailingLineEnding, normalizeLineEndings } from '../../../core/lines';
	import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
	import { blockNodeAt, cutRangeFromDisplay } from '../../../tree-operations/node-ops';
	import { applyLiveRangeEdit } from '../text/live-selection-edit';
	import { hasSelection as hasSelectionHelper } from '../../../cursor/content-offsets';
	import { FALLBACK_CONTENT_WIDTH } from '../../../cursor/typography-estimates';
	import {
		rawTextOfNode,
		containerDomTextLength,
		landableDomTextBounds,
		createRangeAtDomTextOffsets,
		screenVisibilityOf,
		selectionFocusWalkOffset
	} from '../../../cursor/widget-offset';
	import { asRawOffset, toDomTextOffset, type RawOffset } from '../../../cursor/coordinate-spaces';
	import { createAmbientCursorIO } from '../../../ambient/ambient-cursor';
	import { getCurrentCursorEditorRelativeX } from '../../../cursor/sticky-measure';
	import { handleSharedKeydown, handleSharedBeforeInput } from '../../../selection/shared-keydown';
	import {
		createEditableSurface,
		createClipboardHandlers,
		consumePendingRestore
	} from '../editable-surface';
	import { wireSurfaceContexts, useParkFocusOnUnmount } from '../surface-wiring.svelte';
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
	import { createCompositionSeat } from '../text/composition-seat';
	import { resolvedInlineContent } from '../../../core/inline/inline-cache';
	import { widgetElByStart } from '../text/widget-adjacency';
	import { getInlineWidgetEditing } from '../../../core/inline/inline-widgets';
	import { enterLinkCardAtCaret, linkCardTargetAt } from '../../link-card/link-card-entry';

	type ExitDirection = 'up' | 'down';

	// The chord that continues a select-all run rather than ending it.
	const SELECT_ALL_CHORD = 'Mod+A';

	let {
		node,
		index,
		myPath = [],
		rowIdx,
		columnCount,
		rowCount,
		alignment = 'none',
		slots
	}: {
		node: NodeView;
		index: number;
		myPath?: number[];
		rowIdx: number;
		columnCount: number;
		rowCount: number;
		alignment?: TableAlignment;
		slots?: RefSlots<BlockComponent>;
	} = $props();

	// A cell's position among its row's children IS its column.
	const colIdx = $derived(index);

	const wiring = wireSurfaceContexts();
	const {
		blockEdit: parentBlockEdit,
		focusActions,
		controller,
		pasteCoordinator,
		stickyColumn,
		edgeAffinity,
		selection,
		getDoc,
		getBlockElByPath,
		getEditorRoot,
		events: editorEvents,
		linkRef
	} = wiring.deps;
	const tableContext = getContext<TableContext>(TABLE_CONTEXT_KEY);
	const {
		pendingMarks,
		widgetSelection,
		linkCard,
		reorder,
		rects,
		decorations: decorationEngine
	} = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const {
		presentationMode: getPresentationMode,
		theme: getTheme,
		resolveLinkUrl,
		onPasteImage
	} = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const { contentVersion: getContentVersion, lifetime: editorLifetime } =
		getContext<EditorDoc>(EDITOR_DOC_KEY);
	const presentationMode = $derived(getPresentationMode?.() ?? 'source');
	const readOnly = $derived(presentationMode === 'reading');

	// A constant fallback keeps an empty island set out of the render key.
	const NO_ISLANDS: IndexedDecoration<WidgetDecoration | ReplaceDecoration>[] = [];

	// ── The cell's write door ───────────────────────────────────────────────
	//
	// Every write of this cell's raw goes through `blockEdit`; the escape is the kind's
	// (`normalizeRawWrite`, at the write sink). The caret half stays here: `caretAfter` addresses
	// the text the caller wrote, so the sink's backslashes move it; `caretBefore` addresses the
	// already-escaped pre-write bytes and stays unmapped.
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
		...wiring.deps,
		// The wiring's blockEdit is the parent door; this surface writes through the
		// cell's escaping one above.
		blockEdit,
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
		getPresentationMode,
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
		getAffinity: () => edgeAffinity.get(),
		getScreen: () => screenVisibilityOf(el ?? null),
		consumePendingMarks: () => pendingMarks.consume(),
		restorePendingMarks: (marks) => pendingMarks.restore(marks)
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
		get containerParent() {
			return blockNodeAt(getDoc(), myPath.slice(0, -1));
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
		getEdgeAffinity: () => edgeAffinity.get(),
		pendingMarks,
		installedAs: 'cell'
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

	/** The card's query for this cell. `range` is null at the chord's arm, where a create would
	 *  have to answer the pipe escapes in cell raw, and the live one at the pressed read. */
	const linkCardQuery = (contentEl: HTMLElement, range: { start: number; end: number } | null) => ({
		contentEl,
		block: node,
		path: myPath,
		linkRef,
		mode: presentationMode,
		selection: range,
		crossBlockRange: selection.isCrossBlock
	});

	// A toolbar asks once per button on every selection change, so the buttons share the parse.
	const formatActive = createInlineFormatActiveMemo();

	// The pressed-state read: the same cell text and selection the toggle itself takes, and for
	// the card the same construct its own entry resolves.
	export function isCommandActive(id: CommandId): boolean {
		if (!el) return false;
		const marked = inlineMarkForCommand(id);
		if (!marked) {
			if (id !== 'link.openCard') return false;
			return linkCardTargetAt(linkCardQuery(el, cursor.getRawSelection())) !== null;
		}
		const caret = cursor.getRaw() ?? 0;
		const selection = cursor.getRawSelection() ?? { start: caret, end: caret };
		const cellText = readCellText();
		return formatActive(
			{ display: cellText, content: { start: 0, end: cellText.length }, selection },
			marked.kind
		);
	}

	// Claims the chord even with no caret to act on: declining leaves Mod+B to the browser's
	// own contenteditable bold, an edit this surface never authored.
	function toggleFormat(format: InlineMarkKind): boolean {
		if (!el) return true;
		const caret = cursor.getRaw();
		// A collapsed caret is the empty-pair contract, not a bail — see toggleInlineFormat.
		const offsets =
			cursor.getRawSelection() ?? (caret === null ? null : { start: caret, end: caret });
		if (!offsets) return true;
		// Same fork as the prose surface, on the same question the toggle door asks: a surface
		// painting no delimiter would hold an abandoned empty pair as invisible garbage in the
		// cell's bytes (live-mode.md § 4.3).
		if (!paintsFocusedMarkers(presentationMode) && offsets.start === offsets.end) {
			controller.flushDebouncedCheckpoint();
			pendingMarks.toggle(format);
			return true;
		}
		// A cell has no markers of its own, so the whole read is content — taken from the DOM text
		// rather than `getContentRange(node)`, whose bytes carry the escapes the door writes.
		const cellText = readCellText();
		const result = toggleInlineFormat(
			{ display: cellText, content: { start: 0, end: cellText.length }, selection: offsets },
			format,
			presentationMode
		);
		if (!result) return true;
		// Anchor undo at the live post-toggle caret: cross-block dispatch arrives with no
		// preceding onKeyDown, so `preEditOffset` would be stale (mirrors TextEditableBlock).
		// A command is not typing, so the toggle's bytes are their own undo step.
		controller.isolateUndoEntry(() =>
			blockEdit.updateBlockContent(index, result.newDisplay, result.newSelStart, result.newSelStart)
		);
		// The door may have inserted backslashes inside the toggled span, so both selection
		// edges are read back through the escape.
		const selStart = escapedCellOffset(result.newDisplay, result.newSelStart);
		const selEnd = escapedCellOffset(result.newDisplay, result.newSelEnd);
		void tick().then(() => setSelection(selStart, selEnd));
		return true;
	}

	/**
	 * The cell's mutation funnel. A live reveal holds this cell's bytes in ephemeral DOM the CST
	 * has not seen, so a mutation would either splice the pre-reveal source or re-derive the whole
	 * row from cell raws — dropping the edit. Fold, settle, then act.
	 */
	function afterRevealFold(run: () => void): void {
		if (!widgetInteraction.isRevealing()) {
			run();
			return;
		}
		const fold = widgetInteraction.foldRevealBeforeMutation();
		void (fold?.settled ?? tick()).then(run);
	}

	/** One arm per command this cell owns, resolved BEFORE any fold so the fold sits between
	 *  resolution and mutation — the prose surface's split. Null declines the chord. */
	function cellCommand(id: CommandId, contentEl: HTMLElement): (() => void) | null {
		// The format chords are rows: the construct that declares a mark names the command that
		// toggles it, so this surface grows a new one without an arm.
		const marked = inlineMarkForCommand(id);
		if (marked) return () => void toggleFormat(marked.kind);
		// Consumed whether or not it enters, the prose surface's rule on this surface too:
		// `reservedChords()` reports Mod+K as the editor's wherever the keymaps bind it.
		if (id === 'link.openCard') {
			return () => enterLinkCardAtCaret({ ...linkCardQuery(contentEl, null), card: linkCard });
		}
		const axisCommand = tableAxisCommand(id);
		if (axisCommand) {
			return () =>
				void tableContext[axisCommand.action](axisCommand.axis === 'row' ? rowIdx : colIdx);
		}
		// Moves the whole table: the reorder walk resolves the unit at the nearest ancestor
		// that reorders its children, which a table's grid rows are not.
		if (id === 'block.moveUp' || id === 'block.moveDown') {
			return () => void reorder.nudgeReorderUnit(myPath, id === 'block.moveUp' ? -1 : 1);
		}
		if (id !== 'cell.enter' && id !== 'cell.tab' && id !== 'cell.shiftTab') return null;
		const plan = cellKeydownPlan(
			{
				key: id === 'cell.enter' ? 'Enter' : 'Tab',
				ctrlOrMeta: false,
				shiftKey: id === 'cell.shiftTab',
				altKey: false
			},
			cellPlanState(cursor.getRaw() ?? 0)
		);
		if (plan.kind === 'native' || plan.kind === 'select-all-step') return null;
		return () => void applyCellPlan(plan);
	}

	// Every chord the `tableCell` keymap binds arrives here, including from cross-block
	// dispatch, which carries no event — so the 'native'/'select-all-step' plans are
	// declined by the arm table and only the action plans run.
	export function runCommand(id: CommandId): boolean {
		if (!el) return false;
		const perform = cellCommand(id, el);
		if (!perform) return false;
		afterRevealFold(perform);
		return true;
	}

	// The ONE surface literal: the row mounts this cell with no `bind:this`, so the published slot
	// is the only channel a caller reaches it through — and the parity G4.38 scans.
	$effect(() => {
		if (!slots) return;
		const self = {
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
			snapCaretToPoint,
			insertMarkdown: clipboard.insertMarkdown
		} satisfies BlockComponent;
		return publishRefSlot(slots, index, self, el);
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
		get presentationMode() {
			return presentationMode;
		},
		getTheme,
		getDocument: () => getDoc(),
		getContentVersion,
		navigateTo: (path) => rects.navigateTo(path),
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
			consumePendingRestore(el, pendingCursorOffset, (offset) =>
				cursor.setRaw(asRawOffset(offset))
			);
			pendingCursorOffset = null;
		}
	});

	$effect(() => () => cellRender.dispose());

	useParkFocusOnUnmount(() => el ?? null, getEditorRoot);

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

	// Not textContent: a rendered widget carries zero textContent but several raw bytes.
	function readCellText(): string {
		return el ? rawTextOfNode(el, node.raw) : '';
	}

	// Zero-ambient cell: the walk offset IS the raw offset.
	function getRawFocusOffset(): RawOffset | null {
		return el ? selectionFocusWalkOffset(el, 0) : null;
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
		// Zero-ambient cell: the walk offsets ARE the raw offsets the plan compares. Deliberately
		// unguarded by mode, unlike the prose bounds — a cell's hop follows what is ON SCREEN, so
		// the bound tracks preview-inline's proximity reveal.
		const bounds = landableDomTextBounds(el!);
		return {
			rowIdx,
			colIdx,
			columnCount,
			rowCount,
			offset,
			contentStart: bounds.start,
			contentEnd: bounds.end,
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
		if (wiring.dispatchChord(e, { kind: node.kind, runCommand })) return;

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

	// The navigation plans, no live event needed; the caller preventDefaults. The fold is here
	// rather than at each caller: insert-row-below rebuilds every row from cell raws, so an open
	// reveal's edit would be re-derived away.
	async function applyCellPlan(plan: CellKeyPlan): Promise<void> {
		const fold = widgetInteraction.foldRevealBeforeMutation();
		if (fold) await fold.settled;
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
		const bounds = landableDomTextBounds(el);
		const atEdge =
			key === 'ArrowDown'
				? isAtLastVisualLine(el, offset, bounds.end)
				: isAtFirstVisualLine(el, offset, bounds.start);
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
		// the selection leaves the table. The seed is minted before the extend can answer, so
		// a decline (no block past the table) has to take it back: the stored pair would be an
		// invisible selection the next Backspace deletes the whole cell through.
		selection.enterCrossBlock(anchor, { path: tablePath.slice(), offset: currentIdx });
		const extended =
			ext.direction === 'forward'
				? extendFocusToNextBlock(selection, getDoc(), el, ext.fromCellPath, 'vertical')
				: extendFocusToPreviousBlock(selection, getDoc(), el, ext.fromCellPath, 'start');
		if (!extended) {
			selection.collapse();
			return false;
		}
		return true;
	}

	function exitWithStickyX(direction: ExitDirection): void {
		if (!el) return;
		const x = getCurrentCursorEditorRelativeX(el) ?? 0;
		if (direction === 'up') tableContext.exitUpward(x);
		else tableContext.exitDownward(x);
	}

	// The cell at the prose surface's live ranged-edit arm: a native edit over a range spanning
	// hidden delimiters is the destructive family with no seam offsets of its own.
	function handleLiveSelectionEdit(e: InputEvent): boolean {
		return applyLiveRangeEdit(
			e,
			node,
			cursor,
			presentationMode,
			linkRef,
			'',
			widgetInteraction.isRevealing,
			(edit) => {
				void blockEdit.updateBlockContent(index, edit.raw, edit.range.start, edit.caret);
				parkCursor(edit.caret, edit.raw);
			}
		);
	}

	async function onBeforeInput(e: InputEvent): Promise<void> {
		if (await handleSharedBeforeInput(e, sharedCtx)) return;
		if (handleLiveSelectionEdit(e)) return;
		if (e.inputType === 'insertLineBreak') {
			// GFM cells can't carry raw newlines, so a line break is a literal `<br>`,
			// which the inline-HTML pipeline renders as a live widget.
			e.preventDefault();
			if (!el) return;
			// Both reads below are taken AFTER the fold: the committed text is what the offset
			// they splice must be measured against.
			const fold = widgetInteraction.foldRevealBeforeMutation();
			if (fold) await fold.settled;
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
	const clipboard = createClipboardHandlers({
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
		pasteTail: async (pastedText) => {
			if (!el) return;
			const selOffsets = cursor.getRawSelection();
			const start = selOffsets ? selOffsets.start : (cursor.getRaw() ?? 0);
			await applyCellPaste(pastedText, { start, end: selOffsets ? selOffsets.end : start });
		}
	});
	const { onCopy, onCut, onPaste } = clipboard;

	// ── Shared mutation primitives (event handlers + right-click menu) ───────

	// The truncation is a join like the paste's delete half: in live the runs it strands are
	// bytes the reader never saw, so it crosses the same seam ahead of the escaping sink
	// (live-mode.md § 4.5).
	function deleteCellRange(start: number, end: number): void {
		const display = trimTrailingLineEnding(node.raw);
		const cut = cutRangeFromDisplay(node, display, { start, end }, presentationMode, linkRef);
		void blockEdit.updateBlockContent(index, cut.display, start, cut.offset);
		parkCursor(cut.offset, cut.display);
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
			{
				doc: getDoc(),
				blockEdit,
				controller: pasteCoordinator,
				// The delete half is a join like any other, and a cell's is no more literal than a
				// paragraph's: without the seam a live cut pastes the runs it stranded into view.
				seam: { presentationMode, linkRef }
			}
		);
		// Already escaped: the cell's paste surface reports its caret in escaped space.
		if (result.inlineCaretOffset !== undefined) parkCursor(result.inlineCaretOffset);
	}

	// ── Right-click menu clipboard (no ClipboardEvent) ──────────────────────
	//
	// Copy/Cut restore the range and fire `execCommand('copy')`, keeping the clipboard write
	// synchronous the way Tauri needs and `navigator.clipboard.writeText` isn't. `execCommand('cut')`
	// is unusable because onCut's write trails an await, so Cut copies then deletes; paste has no
	// sync equivalent at all.

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
		// Right-click deliberately skips the pointerdown reset, so the reveal is still open here
		// and `sel` was captured in the REVEALED DOM's coordinates — a fold before any of it.
		const fold = widgetInteraction.foldRevealBeforeMutation();
		if (fold) await fold.settled;
		// A rectangle has no cell-local range to restore: refocusing keeps it live in
		// SelectionState, and the onCopy/onCut rect arms do the rest.
		const hasRect = action !== 'paste' && intraTableRectPayload({ selection, getDoc }) !== null;
		if (action !== 'paste' && !hasRect && sel.start === sel.end) return;
		// Clicking the menu item moved focus off the cell, so every branch refocuses before
		// mutating: execCommand needs the restored range, paste needs a focused caret.
		stickyColumn.reset();
		edgeAffinity.reset();
		el.focus();
		if (action === 'paste') {
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
		if (hasRect) {
			document.execCommand('copy');
			if (action === 'cut') await crossBlock.performCrossBlockDeleteFromEvent();
			return;
		}
		setSelection(sel.start, sel.end);
		document.execCommand('copy');
		if (action === 'cut') deleteCellRange(sel.start, sel.end);
	}

	// A click past a widget drops the caret at an element-level position with no text
	// anchor, so snap to the nearest widget edge (or reveal). Normal text clicks fall
	// through untouched.
	function onClick(e: MouseEvent): void {
		const x = lastClickClientX;
		const y = lastClickClientY;
		lastClickClientX = null;
		lastClickClientY = null;
		widgetInteraction.snapClickToWidgetEdge(x, y, {
			modified: e.ctrlKey || e.metaKey,
			clickCount: e.detail
		});
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
