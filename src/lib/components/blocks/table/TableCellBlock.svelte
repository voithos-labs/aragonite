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
	import type { AnyInlineKind, TableAlignment } from '../../../core/nodes';
	import { trimTrailingLineEnding, normalizeLineEndings } from '../../../core/lines';
	import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
	import { blockNodeAt, isBlockNode, nodeAt } from '../../../tree-operations/node-primitives';
	import { cutRangeFromDisplay } from '../../../tree-operations/node-ops';
	import { applyLiveRangeEdit } from '../text/live-selection-edit';
	import {
		gridToHtmlTable,
		parseClipboardGrid,
		tileGridTo
	} from '../../../tree-operations/table-grid-clipboard';
	import { tableCellCount } from '../../../selection/table-endpoint-snap';
	import { pathsEqual } from '../../../selection/path-math';
	import { applyDelimiterAutoPair } from '../text/delimiter-autopair';
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
		consumePendingRestore,
		withKeydownVerdict
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
	import {
		intraTableRectPayload,
		intraTableRectBounds,
		intraTableRectGrid
	} from './cell-clipboard';
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
	import { useBlockDecorations } from '../../../decorations/use-block-decorations.svelte';
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

	// A cell's position among its row's children is its column.
	const colIdx = $derived(index);
	// A GFM table's first row is always its header.
	const isHeaderRow = $derived(rowIdx === 0);

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
		grammar,
		activePlugins,
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

	// A shared constant keeps an empty decoration list out of the render key.
	const NO_ISLANDS: IndexedDecoration<WidgetDecoration | ReplaceDecoration>[] = [];

	// ── How the cell writes its bytes ───────────────────────────────────────
	//
	// Every write of this cell's raw goes through `blockEdit`; the escaping is the kind's, in
	// `normalizeRawWrite`. The caret half stays here: `caretAfter` counts into the text the caller
	// wrote, so the inserted backslashes move it, while `caretBefore` counts into the
	// already-escaped bytes and is left alone.
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

	// The cell renders no block host, so its own element carries the decorations addressed to it.
	const blockDecorations = useBlockDecorations({
		getPath: () => myPath,
		getEl: () => el ?? null,
		engine: decorationEngine,
		onRenderError: (error) => editorEvents?.emit('error', error),
		badgeRefusal: "a table cell's children are its editable text, re-rendered on every edit"
	});

	let composing = $state(false);
	// A widget's shown source lives only in the DOM, so `onInput` skips the per-keystroke CST
	// commit and the cell commits once when it is hidden, as TextEditableBlock does.
	let revealing = $state(false);
	let pendingCursorOffset = $state<number | null>(null);

	// The other half of that write path, and the only write of `pendingCursorOffset` besides the
	// render effect's clear. A pending cursor never goes through `blockEdit`, so the caller hands
	// over the text its offset counts into; no text means it already counts into escaped bytes.
	function parkCursor(offset: number | null, writtenText?: string): void {
		pendingCursorOffset =
			offset === null || writtenText === undefined
				? offset
				: escapedCellOffset(writtenText, offset);
	}

	// Y matters for the hit test: a click at the same column on another visual line
	// must not open a source.
	let lastClickClientX: number | null = null;
	let lastClickClientY: number | null = null;

	// A cell carries no marker prefix, so the factory gives plain widget-aware cursor reads
	// in raw units; counting `textContent` would undercount a widget's bytes.
	const cursor = createAmbientCursorIO({
		getEl: () => el ?? null,
		getAmbientLength: () => 0
	});

	const editableSurface = createEditableSurface({
		...wiring.deps,
		// The shared wiring's `blockEdit` is the parent's; this cell writes through its
		// own escaping one above.
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
		setPendingCursor: (offset) => parkCursor(offset),
		getPresentationMode,
		getFocusOffset: () => getRawFocusOffset(),
		getTextLen: () => (el ? containerDomTextLength(el) : 0),
		readText: () => readCellText(),
		relocateComposedText: (after, composedAt) => compositionSeat.relocate(after, composedAt),
		// `saved` re-focuses if the edit remounts the cell, so it is reported through
		// the escaping write above.
		commitInput: (text, preEdit, saved) => {
			void blockEdit.updateBlockContent(index, text, preEdit, saved);
			return escapedCellOffset(text, saved);
		},
		handleBeforeInput: onBeforeInput
	});

	// The same placement rules the keydown dispatch uses, for the one insertion it cannot reach.
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

	// The same inline-widget code prose uses, with cell-shaped dependencies: no marker prefix,
	// no snap indicator, since cells render no image widgets, and the escaping `blockEdit`.
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

	// A widget's editing policy under this editor's grammar, the one the cell rendered with.
	const widgetEditing = (kind: AnyInlineKind) => getInlineWidgetEditing(kind, grammar);

	// The one caret-edge dispatch (G4.12), the same code prose uses: a plain edge key against
	// a CST widget or a decoration widget resolves against its declared policy.
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
		// A widget that cannot show its source, reached this way, was reached by an arrow
		// key, so step the caret over it as contenteditable would.
		enterWidget: (widget, fromTrailingEdge) => {
			if (widgetEditing(widget.kind)?.revealSource) {
				widgetInteraction.enterWidget(widget, fromTrailingEdge);
			} else {
				cursor.setRaw(asRawOffset(fromTrailingEdge ? widget.start : widget.end));
			}
		},
		// A cell draws no selection outline around a widget, so the prose select-then-delete
		// default would show nothing between the two keys. Limited to what the cell actually
		// draws as a widget, and merged onto the registered policy rather than replacing it.
		widgetEdgePolicy: (widget) => {
			const registered = widgetEditing(widget.kind);
			if (!el || registered?.revealSource) return undefined;
			return widgetElByStart(el, widget.start)
				? { ...registered, deleteGranularity: 'atomic' }
				: undefined;
		},
		isReading: () => readOnly,
		getEdgeAffinity: () => edgeAffinity.get(),
		noteOutside: edgeAffinity.noteExtreme,
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

	/** What the link card is asked about here. `range` is null when the chord runs, since a
	 *  create would have to deal with a cell's pipe escapes, and the live one when the pressed
	 *  state is read. */
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

	// Whether a button shows as pressed: the same cell text and selection the toggle itself
	// uses, and for the card the same construct its own entry resolves.
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
			{ display: cellText, content: { start: 0, end: cellText.length }, selection, grammar },
			marked.kind
		);
	}

	// Takes the chord even with no caret to act on: declining leaves Mod+B to the browser's
	// own contenteditable bold, an edit this block never wrote.
	function toggleFormat(format: InlineMarkKind): boolean {
		if (!el) return true;
		const caret = cursor.getRaw();
		// A collapsed caret is the empty-pair case, not a refusal; see `toggleInlineFormat`.
		const offsets =
			cursor.getRawSelection() ?? (caret === null ? null : { start: caret, end: caret });
		if (!offsets) return true;
		// The same branch the prose block takes, on the same question: a block that draws no
		// delimiter would keep an abandoned empty pair as invisible bytes in the cell
		// (live-mode.md § 4.3).
		if (!paintsFocusedMarkers(presentationMode) && offsets.start === offsets.end) {
			controller.flushDebouncedCheckpoint();
			pendingMarks.toggle(format);
			return true;
		}
		// A cell has no markers of its own, so the whole read is content, taken from the DOM text
		// rather than `getContentRange(node)`, whose bytes carry the escapes the write adds.
		const cellText = readCellText();
		const result = toggleInlineFormat(
			{
				display: cellText,
				content: { start: 0, end: cellText.length },
				selection: offsets,
				grammar
			},
			format,
			presentationMode
		);
		if (!result) return true;
		// Anchor undo at the post-toggle caret, and keep it out of any typing batch: a command
		// is not typing, so the toggle's bytes are their own undo step.
		controller.isolateUndoEntry(() =>
			blockEdit.updateBlockContent(index, result.newDisplay, result.newSelStart, result.newSelStart)
		);
		// The write may have inserted backslashes inside the toggled span, so both selection
		// edges are read back through the escaping.
		const selStart = escapedCellOffset(result.newDisplay, result.newSelStart);
		const selEnd = escapedCellOffset(result.newDisplay, result.newSelEnd);
		void tick().then(() => setSelection(selStart, selEnd));
		return true;
	}

	/**
	 * The one place a cell edit starts. A shown source holds this cell's bytes in the DOM, where
	 * the CST has not seen them, so an edit would either splice the old source or rebuild the
	 * whole row from the cell raws and drop the edit. Hide it, wait for the write, then act.
	 */
	function afterRevealFold(run: () => void): void {
		if (!widgetInteraction.isRevealing()) {
			run();
			return;
		}
		const fold = widgetInteraction.foldRevealBeforeMutation();
		void (fold?.settled ?? tick()).then(run);
	}

	/** One entry per command this cell owns, resolved before a shown source is hidden, so hiding
	 *  fits between resolving and writing, as the prose block does. Null declines the chord. */
	function cellCommand(id: CommandId, contentEl: HTMLElement): (() => void) | null {
		// The format chords come from the policy table: a construct that declares a mark names
		// the command that toggles it, so a new one needs no branch here.
		const marked = inlineMarkForCommand(id);
		if (marked) return () => void toggleFormat(marked.kind);
		// Consumed whether or not a card opens, the same rule the prose block follows:
		// `reservedChords()` reports Mod+K as the editor's wherever the keymaps bind it.
		if (id === 'link.openCard') {
			return () => enterLinkCardAtCaret({ ...linkCardQuery(contentEl, null), card: linkCard });
		}
		const axisCommand = tableAxisCommand(id);
		if (axisCommand) {
			return () =>
				void tableContext[axisCommand.action](axisCommand.axis === 'row' ? rowIdx : colIdx);
		}
		// Moves the whole table: a reorder resolves at the nearest ancestor that reorders its
		// children, which a table's grid rows do not.
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
	// dispatch, which carries no event, so the 'native' and 'select-all-step' plans are
	// declined and only the action plans run.
	export function runCommand(id: CommandId): boolean {
		if (!el) return false;
		const perform = cellCommand(id, el);
		if (!perform) return false;
		afterRevealFold(perform);
		return true;
	}

	// The one place this shape is written: the row mounts this cell with no `bind:this`, so the
	// published reference is the only way a caller reaches it, which the G4.38 scan checks.
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
		grammar,
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
			consumePendingRestore(el, pendingCursorOffset, (offset) => {
				if (!widgetInteraction.revealInterior(offset)) cursor.setRaw(asRawOffset(offset));
			});
			pendingCursorOffset = null;
		}
	});

	$effect(() => () => cellRender.dispose());

	useParkFocusOnUnmount(() => el ?? null, getEditorRoot);

	// A selection move that leaves a shown source but stays inside the cell hides it; blur
	// handles focus leaving the cell. A composition suppresses this as it does `onInput`.
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

	// A cell has no marker prefix, so the traversal's offset is the raw offset.
	function getRawFocusOffset(): RawOffset | null {
		return el ? selectionFocusWalkOffset(el, 0) : null;
	}

	// ── Event handlers ─────────────────────────────────────────────────────

	const onInput = editableSurface.onInput;
	// Captured before the shared handler: its cross-block half clears the arrival side, and the
	// first `input` during the composition resets that side to the typed one.
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
		// A cell has no marker prefix, so the traversal's offsets are the raw offsets the plan
		// compares. Deliberately not checked against the mode, unlike the prose bounds: a cell's
		// move follows what is on screen, so the bound tracks what preview-inline shows.
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

		// Ahead of the plan, where the shared handling would run it: that reset is reachable
		// only on the 'native' branch, so every key the plan takes would leave the select-all
		// run active. `eventToChord` declines bare modifiers and uppercase letters.
		const chord = eventToChord(e);
		if (chord !== null && chord !== SELECT_ALL_CHORD) selection.resetSelectAllCount();

		// Must run before `cellKeydownPlan`, which takes arrows and calls `preventDefault`
		// without reaching here, leaving a live selection the next keystroke would replace.
		if (selection.isCrossBlock && (await crossBlock.handleKeyDown(e))) return;

		// The source-showing and selection handlers run before the plan, which would otherwise
		// read an ArrowUp or ArrowDown inside a shown source as cell navigation.
		if ((await widgetInteraction.handleRevealingKeydown(e)) || editableSurface.isDetached()) return;
		// Enter is a cell's exception: prose splits, a cell moves a row, and moving would
		// carry the uncommitted edit out of the cell that owns it. Commit and stay put.
		if (widgetInteraction.isRevealing() && e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			widgetInteraction.foldRevealBeforeMutation();
			return;
		}
		if ((await widgetInteraction.handleSelectedWidgetKeydown(e)) || editableSurface.isDetached())
			return;
		if (widgetInteraction.handleShiftArrowIntoWidget(e)) return;

		const caretBeforeKey = cursor.getRaw() ?? 0;

		// First, because neither the navigation plan's boundary branches nor the shared
		// ArrowLeft-at-0 move tests modifiers: either would eat the column reorder at a cell's
		// left edge. It is also the only point a consumer's `keybindings` override reaches.
		if (wiring.dispatchChord(e, { kind: node.kind, runCommand })) return;

		const plan = cellKeydownPlan(
			{ key: e.key, ctrlOrMeta: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey },
			cellPlanState(caretBeforeKey)
		);

		switch (plan.kind) {
			case 'native': {
				// The first Shift+ArrowUp or Down at a cell's vertical edge takes a whole row;
				// the shared prose extend would instead go to the next block in document order.
				if (
					!selection.isCrossBlock &&
					e.shiftKey &&
					!e.altKey &&
					!e.ctrlKey &&
					!e.metaKey &&
					(e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
					startIntraTableRect(e.key, caretBeforeKey)
				) {
					e.preventDefault();
					return;
				}
				if (await handleSharedKeydown(e, sharedCtx)) return;
				// Runs only where the plan answered 'native': at the text boundaries the plan
				// takes, an entered widget sits outside it and the dispatch declines.
				if (edgeDispatch.handleKeydown(e, cursor.getRaw())) return;
				return;
			}
			// The document's two-stage Ctrl+A, cell first: the step inside the cell is the
			// browser's, and the second keypress takes the document.
			case 'select-all-step':
				selection.incrementSelectAllCount();
				if (plan.step === 'native') return;
				e.preventDefault();
				selectWholeDocument(selection, getDoc(), getBlockElByPath);
				return;
			default:
				e.preventDefault();
				// Reading mode keeps navigation and consumes the structural plans.
				if (readOnly && plan.kind !== 'focus-cell' && plan.kind !== 'exit') return;
				await applyCellPlan(plan);
				return;
		}
	}

	const onKeyDownTraced = withKeydownVerdict(onKeyDown);

	// The navigation plans, which need no live event; the caller calls `preventDefault`. A shown
	// source is hidden here rather than at each caller, because insert-row-below rebuilds every
	// row from the cell raws and would discard the edit.
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

	// Start a rectangle inside the table from a collapsed cell caret on the first
	// Shift+ArrowUp or Down. Only at the cell's visual edge, so a multi-line cell still
	// extends its own text first, as prose does. Returns false to fall through.
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
		// Start the rectangle at the current cell, then hand off to the block-level extend so
		// the selection leaves the table. That start is recorded before the extend can answer,
		// so a refusal, when there is no block past the table, has to take it back: the stored
		// pair would be an invisible selection the next Backspace deletes a whole cell through.
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

	// The cell's version of the prose block's live range edit: a browser edit over a range
	// spanning hidden delimiters, the one destructive case with no offsets of its own.
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

	// The cell's version of the prose block's self-closing delimiters (delimiter-autopair.ts).
	function handleDelimiterAutoPair(e: InputEvent): boolean {
		return applyDelimiterAutoPair(e, {
			text: readCellText,
			content: () => ({ start: 0, end: readCellText().length }),
			caret: () => cursor.getRaw(),
			hasSelection: () => cursor.getRawSelection() !== null,
			isRevealing: widgetInteraction.isRevealing,
			foldReveal: () => widgetInteraction.foldRevealBeforeMutation(),
			markersPaint: () => paintsFocusedMarkers(presentationMode),
			setCaret: (offset) => cursor.setRaw(asRawOffset(offset)),
			seatOutside: edgeAffinity.noteExtreme,
			grammar,
			write: (text, caretBefore, caretAfter) => {
				void blockEdit.updateBlockContent(index, text, caretBefore, caretAfter);
				parkCursor(caretAfter, text);
			}
		});
	}

	async function onBeforeInput(e: InputEvent): Promise<void> {
		if (await handleSharedBeforeInput(e, sharedCtx)) return;
		if (handleLiveSelectionEdit(e)) return;
		if (handleDelimiterAutoPair(e)) return;
		if (e.inputType === 'insertLineBreak') {
			// GFM cells can't carry raw newlines, so a line break is a literal `<br>`,
			// which the inline-HTML pipeline renders as a live widget.
			e.preventDefault();
			if (!el) return;
			// Both reads below happen after the source is hidden: the committed text is what
			// the offset they splice must be measured against.
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
		// A click on a widget that can show its source is this editor's gesture: cancel the
		// browser's caret default and skip the drag so nothing races its own placement.
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

	// Copy, cut and paste through the shared handlers. The cell adds two cases: a rectangle
	// inside the table, copied as a GFM sub-table, and a raw slice of one cell, which keeps
	// widget bytes such as `<br>` that a copy of the rendered text drops. The rectangle also
	// goes on the clipboard as a spreadsheet table, because Excel and Sheets read text/html.
	function writeRectHtml(e: ClipboardEvent): void {
		const grid = intraTableRectGrid({ selection, getDoc });
		if (grid) e.clipboardData?.setData('text/html', gridToHtmlTable(grid));
	}

	// A grid, whether tabs from a spreadsheet or a GFM table, fills cells starting here: the
	// rectangle's top-left when one is live, otherwise this cell, growing the table to fit. A
	// whole-table selection still replaces, and a payload that is not a grid pastes as usual.
	async function pasteGridHere(text: string): Promise<boolean> {
		const grid = parseClipboardGrid(text);
		if (!grid) return false;
		const tablePath = myPath.slice(0, -2);
		const bounds = intraTableRectBounds({ selection, getDoc });
		const inThisTable = bounds !== null && pathsEqual(bounds.tablePath, tablePath);
		if (bounds && !inThisTable) return false;
		const tableNode = nodeAt(getDoc(), tablePath);
		const wholeTable =
			bounds !== null &&
			tableNode !== null &&
			isBlockNode(tableNode) &&
			bounds.rows * bounds.cols === tableCellCount(tableNode);
		if (wholeTable) return false;
		const origin = bounds ? { rowIdx: bounds.top, colIdx: bounds.left } : { rowIdx, colIdx };
		const fitted = bounds ? tileGridTo(grid, bounds.rows, bounds.cols) : grid;
		if (bounds) selection.collapse();
		await tableContext.pasteGrid(origin, fitted);
		return true;
	}

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
			writeRectHtml(e);
			return true;
		},
		pastePreHook: pasteGridHere,
		// While a source is shown the DOM holds an edit `node.raw` has not seen; copy never
		// writes, so it slices the live DOM text rather than hiding it first.
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
		// Clears the cells in place, without `tableCoverageDelete`: only Backspace's
		// structural delete removes rows, columns or the table.
		cutPreHook: async (e) => {
			const rectPayload = intraTableRectPayload({ selection, getDoc });
			if (rectPayload === null) return false;
			e.clipboardData?.setData('text/plain', rectPayload);
			writeRectHtml(e);
			await crossBlock.performCrossBlockDeleteFromEvent();
			return true;
		},
		// The write has to be synchronous, since `clipboardData` closes after the event, and
		// the truncation goes through the CST: the browser's own cut leaves a stale undo anchor.
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

	// ── Shared edit helpers (event handlers and the right-click menu) ────────

	// The truncation is a join like the paste's delete half: in live mode the runs it strands
	// are bytes the user never saw, so it goes through the same join rules before the escaping
	// write (live-mode.md § 4.5).
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
				grammar,
				activePlugins,
				// The delete half is a join like any other, and a cell's is no more literal than
				// a paragraph's: without it a live cut pastes the runs it stranded into view.
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
		// Right-click deliberately skips the pointerdown reset, so a source may still be showing
		// and `sel` was captured against that DOM, which is why it is hidden before anything else.
		const fold = widgetInteraction.foldRevealBeforeMutation();
		if (fold) await fold.settled;
		// A rectangle has no range inside one cell to restore: refocusing keeps it live in
		// `SelectionState`, and the copy and cut branches for a rectangle do the rest.
		const hasRect = action !== 'paste' && intraTableRectPayload({ selection, getDoc }) !== null;
		if (action !== 'paste' && !hasRect && sel.start === sel.end) return;
		// Clicking the menu item moved focus off the cell, so every branch refocuses before
		// mutating: execCommand needs the restored range, paste needs a focused caret.
		stickyColumn.reset();
		edgeAffinity.reset();
		el.focus({ preventScroll: true });
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

<!-- The cell is an editing host, which the compiler cannot see through a role it has to compute. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	bind:this={el}
	tabindex="0"
	class={['table-cell', ...blockDecorations.classes]}
	contenteditable={readOnly ? 'false' : 'true'}
	role={isHeaderRow ? 'columnheader' : 'cell'}
	style:text-align={alignment === 'none' ? undefined : alignment}
	oninput={onInput}
	onkeydown={onKeyDownTraced}
	onbeforeinput={editableSurface.onBeforeInput}
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
	/* Two sides only. The grid has no `border-collapse`, so a cell drawing all four put two
	   1px lines on every shared edge — visibly heavier inside the table than around it. The
	   container draws the top and left, these draw the right and bottom, and every rule in
	   the grid is one line wide. */
	.table-cell {
		outline: none;
		padding: 4px 8px;
		min-height: 1.4em;
		white-space: pre-wrap;
		word-wrap: break-word;
		border-right: 1px solid var(--color-border, #3e3e3b);
		border-bottom: 1px solid var(--color-border, #3e3e3b);
	}
	.table-cell:focus {
		outline: 2px solid var(--color-accent, #567b67);
		outline-offset: -2px;
	}
</style>
