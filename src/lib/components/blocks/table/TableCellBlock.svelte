<script lang="ts">
	import { getContext, onDestroy } from 'svelte';
	import type { TableContext } from '../../../action-contracts';
	import { type BlockComponent } from '../../../block-component';
	import { type CommandId } from '../../../schema/commands';
	import { endsSelectAllRun } from '../../../schema/keybindings';
	import { inlineMarkForCommand } from '../../../schema/inline-construct-policy';
	import type { NodeView } from '../../../core/node-views';
	import { TABLE_CONTEXT_KEY } from '../../../editor-keys';
	import type { AnyInlineKind, TableAlignment } from '../../../core/nodes';
	import { blockNodeAt } from '../../../tree-operations/node-primitives';
	import { replaceRangeInLeaf } from '../../../tree-operations/leaf-range';
	import { storedAsAt } from '../../../tree-operations/stored-as';
	import { parseClipboardGrid, tileGridTo } from '../../../tree-operations/table-grid-clipboard';
	import { pathsEqual } from '../../../selection/path-math';
	import { FALLBACK_CONTENT_WIDTH } from '../../../windowing/typography-estimates';
	import { rawTextOfNode } from '../../../browser/block-text';
	import {
		containerDomTextLength,
		landableDomTextBounds,
		type RawRange
	} from '../../../browser/offsets';
	import { rawSelectionFocus } from '../../../browser/selection-read';
	import { asRawOffset, rowMajorCellIndex, type RawOffset } from '../../../core/coordinate-spaces';
	import { createSurfaceBackend } from '../editable/surface-backend';
	import { getCurrentCursorEditorRelativeX } from '../../../caret/sticky-measure';
	import { handleEdgeStep, handleSharedKeydown } from '../../../selection/shared-keydown';
	import { createEditableSurface, consumePendingRestore } from '../editable/editable-surface';
	import { createTextClipboard } from '../text/text-clipboard';
	import { createInlineCommands } from '../text/inline-commands';
	import { createTypedInput } from '../text/typed-input';
	import { rangeWrite } from '../editable/surface-write';
	import { wireSurfaceContexts, useParkFocusOnUnmount } from '../editable/surface-wiring.svelte';
	import { resetForPointerDown } from '../../../selection/cross-block/pointer';
	import type { PointerPressOptions } from '../../../selection/cross-block/dispatch';
	import { publishRefSlot, type RefSlots } from '../../../block-lists/child-refs';
	import { selectWholeDocument, extendFromCell } from '../../../selection/keyboard-extend';
	import { isAtFirstVisualLine, isAtLastVisualLine } from '../../../browser/visual-lines';
	import {
		cellCommandPlan,
		cellKeydownPlan,
		type CellKeyPlan,
		type CellKeyState
	} from './cell-keydown-plan';
	import { tableAxisCommand } from './cell-table-commands';
	import { cellPoint } from '../../../selection/primitives';
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
	import type { LandsRestoredCaret } from '../../../selection/restored-caret';
	import { createEdgePolicyDispatch } from '../text/edge-policy-dispatch';
	import { createEdgeStep } from '../text/edge-step';
	import { createTypedPlacement } from '../text/edge-seat';
	import { resolvedInlineContent } from '../../../core/inline/inline-cache';
	import { getInlineWidgetEditing, widgetElByStart } from '../../../core/inline/inline-widgets';
	import { readClipboardText } from '../../../editor-actions/system-clipboard';

	type ExitDirection = 'up' | 'down';

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
		blockEdit,
		focusActions,
		controller,
		caretMemory,
		caretWriter,
		selection,
		getDoc,
		getBlockElByPath,
		getEditorRoot,
		events: editorEvents,
		reading,
		caretLanding
	} = wiring.deps;
	const { grammar } = reading;
	// Made per gesture, never derived: a derived value would subscribe the cell to the tree.
	const storedAs = () => storedAsAt(getDoc(), myPath, reading);
	const tableContext = getContext<TableContext>(TABLE_CONTEXT_KEY);
	const {
		autoPairs,
		linkCard,
		rects,
		decorations: decorationEngine,
		rangeCoverage,
		shownSource,
		presses,
		textMoves
	} = wiring.services;
	const ownPairs = autoPairs.forBlock();
	const { theme: getTheme, resolveLinkUrl, activationClick } = wiring.policies;
	const { contentVersion: getContentVersion, lifetime: editorLifetime } = wiring.doc;
	const readOnly = $derived(reading.mode() === 'reading');

	// A shared constant keeps an empty decoration list out of the render key.
	const NO_ISLANDS: IndexedDecoration<WidgetDecoration | ReplaceDecoration>[] = [];

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
	let pendingCursorOffset = $state<number | null>(null);

	// The only writer of `pendingCursorOffset` besides the render's clear. The offset counts
	// stored bytes, escapes included: a write hands back its caret already mapped.
	function parkCursor(offset: number | null): void {
		pendingCursorOffset = offset;
	}

	const cursor = createSurfaceBackend({
		getEl: () => el ?? null,
		caretWriter
	});

	const edgeStep = createEdgeStep({
		getEl: () => el ?? null,
		getRaw: () => node.raw,
		getInlines: () => resolvedInlineContent(node, reading),
		getCaret: () => (cursor.getRawSelection() ? null : cursor.getRaw()),
		isReading: () => readOnly,
		reading,
		caretMemory,
		caretWriter
	});

	const typedPlacement = createTypedPlacement({
		getEl: () => el ?? null,
		getNode: () => node,
		reading,
		caretMemory,
		heldSpace: () => editableSurface.heldSpace,
		insideCloser: () => editableSurface.insideCloser
	});

	const editableSurface = createEditableSurface({
		...wiring.deps,
		getEl: () => el ?? null,
		showsSource: () => widgetInteraction.isRevealing(),
		landCaret: (offset, clamp) => widgetInteraction.restoreCaret(offset, clamp),
		backend: cursor,
		getNode: () => node,
		getMyPath: () => myPath,
		getIndex: () => index,
		getComposing: () => composing,
		setComposing: (value) => {
			composing = value;
		},
		requestCaret: (at) => parkCursor(at),
		ownPairs,
		getFocusOffset: () => getRawFocusOffset(),
		getTextLen: () => (el ? containerDomTextLength(el) : 0),
		stepEdge: edgeStep.step,
		inlineUnits: () => edgeDispatch.inlineUnits,
		readInput: (caret) => ({ text: readCellText(), caret }),
		repaint: () => cellRender.render({ forceRebuild: true }),
		placement: typedPlacement,
		getInlines: () => resolvedInlineContent(node, reading),
		handleKeydown: onKeyDown,
		handleBeforeInput: onBeforeInput,
		deleteAtCaret: (caret, intent) => edgeDispatch.deleteAtCaret(caret, intent),
		deleteBeside: (caret, direction) => edgeDispatch.deleteBeside(caret, direction),
		commandTarget: () => keyTarget,
		removeSelection: (range) =>
			writeText({
				...rangeWrite(node, replaceRangeInLeaf(node, range, '', storedAs())),
				intent: 'command',
				// The removal a typed key makes over a selection, which that key joins.
				history: 'join-typing',
				mode: 'authored',
				source: 'selection-removal'
			})
	});
	const { writeText } = editableSurface;

	const crossBlock = editableSurface.crossBlock;
	const sharedCtx = editableSurface.sharedCtx;

	// The same inline-widget code prose uses, with cell-shaped dependencies: no marker prefix,
	// no snap indicator, since cells render no image widgets.
	const widgetInteraction = createWidgetInteraction({
		storedAs,
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
		getEditorContentWidth: () => getEditorRoot()?.clientWidth ?? FALLBACK_CONTENT_WIDTH,
		cursor,
		selection,
		caretWriter,
		blockEdit,
		writeText,
		focusActions,
		setSnapTarget: () => {},
		setPendingCursor: parkCursor,
		activationClick,
		isCrossBlock: () => selection.isCrossBlock,
		shownSource,
		renderedWidgets: () => cellRender.renderedWidgets(),
		caretMemory,
		pinChipSide: edgeStep.pinChipSide,
		textMoves,
		get reading() {
			return reading;
		}
	});
	onDestroy(widgetInteraction.dispose);

	// A widget's editing policy under this editor's grammar, the one the cell rendered with.
	const widgetEditing = (kind: AnyInlineKind) => getInlineWidgetEditing(kind, grammar);

	// The caret-edge dispatch prose uses, so an edge key against a CST or decoration widget
	// resolves against its declared policy here too (G4.12).
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
		get reading() {
			return reading;
		},
		getEl: () => el ?? null,
		storedAs,
		hasIslands: () =>
			decorationEngine ? decorationEngine.islandsForPath(myPath).length > 0 : false,
		getRawSelection: () => cursor.getRawSelection(),
		writeText,
		// A cell's row has no marker, so a space at the cell's start finishes nothing.
		completeMarker: () => {},
		setSnapTarget: () => {},
		isRevealing: () => widgetInteraction.isRevealing(),
		// An arrow steps over a widget that cannot show its source, since in a cell that is the `<br>`
		// line break or a construct the cell draws as plain source (an image).
		enterWidget: (widget, fromTrailingEdge) => {
			if (widgetEditing(widget.kind)?.revealSource) {
				widgetInteraction.enterWidget(widget, fromTrailingEdge);
			} else {
				cursor.setRaw(asRawOffset(fromTrailingEdge ? widget.start : widget.end), {
					clamp: 'reachable'
				});
			}
		},
		// One press deletes a drawn widget whole, so a `<br>` goes like the line break it is; a
		// construct drawn as source keeps its registered policy.
		widgetEdgePolicy: (widget) => {
			const registered = widgetEditing(widget.kind);
			if (!el || registered?.revealSource) return undefined;
			return widgetElByStart(el, widget.start)
				? { ...registered, deleteGranularity: 'atomic' }
				: undefined;
		},
		isReading: () => readOnly,
		insideCloser: () => editableSurface.insideCloser,
		pendingMarks: editableSurface.pendingMarks,
		caretWriter
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

	const commands = createInlineCommands({
		getEl: () => el ?? null,
		get node() {
			return node;
		},
		get index() {
			return index;
		},
		get path() {
			return myPath;
		},
		reading,
		cursor,
		selection,
		widgets: widgetInteraction,
		surface: editableSurface,
		controller,
		linkCard,
		// A cell has no markers of its own, so its whole text is content, read from the DOM rather
		// than `node.raw`, whose bytes carry the escapes the write adds.
		formatText: () => {
			const display = readCellText();
			return { display, content: { start: 0, end: display.length } };
		},
		setSelection: (start, end) => setSelection(start, end)
	});

	export const isCommandActive = commands.isCommandActive;
	export const afterSourceCommit = commands.afterSourceCommit;

	const typedInput = createTypedInput({
		get node() {
			return node;
		},
		cursor,
		storedAs,
		widgets: widgetInteraction,
		placement: typedPlacement,
		caretMemory,
		hiddenRunAt: edgeStep.hiddenRunAt,
		reading,
		ownPairs,
		writeText,
		edges: edgeDispatch,
		text: () => readCellText(),
		content: () => ({ start: 0, end: readCellText().length })
	});

	/** One entry per command this cell owns, resolved before a shown source is hidden, so hiding
	 *  fits between resolving and writing, as the prose block does. Null declines the chord. */
	function cellCommand(id: CommandId, range: RawRange): (() => void) | null {
		// The format chords come from the policy table: a construct that declares a mark names
		// the command that toggles it, so a new one needs no branch here.
		const marked = inlineMarkForCommand(id);
		if (marked) return () => commands.toggleFormat(marked.kind, range);
		// Consumed whether or not a card opens, as in prose; the null selection means a cell never
		// creates a link.
		if (id === 'link.openCard') return () => commands.enterLinkCard(null);
		const axisCommand = tableAxisCommand(id);
		if (axisCommand) {
			return () =>
				void tableContext[axisCommand.action](axisCommand.axis === 'row' ? rowIdx : colIdx);
		}
		if (id === 'cell.lineBreak') return writeLineBreak;
		if (id !== 'cell.enter' && id !== 'cell.tab' && id !== 'cell.shiftTab') return null;
		const plan = cellCommandPlan(id, cellPlanState(cursor.getRaw() ?? 0));
		return () => void applyCellPlan(plan);
	}

	// Every `tableCell` keymap chord arrives here, some with no event behind them, so only the
	// plans that act without one run.
	export const runCommand = editableSurface.command((id: CommandId): boolean => {
		if (!el) return false;
		// Read before a shown source hides, which collapses the live selection.
		const offset = cursor.getRaw() ?? 0;
		const perform = cellCommand(id, cursor.getRawSelection() ?? { start: offset, end: offset });
		if (!perform) return false;
		commands.perform(id, perform, offset);
		return true;
	});

	const keyTarget = {
		get kind() {
			return node.kind;
		},
		runCommand,
		getPath: () => myPath,
		afterSourceCommit,
		afterSelectionRemoved: editableSurface.afterSelectionRemoved
	};

	// The row mounts this cell without `bind:this`, so this registered reference is the only way
	// a caller reaches it (G4.38).
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
			isCommandActive,
			afterSourceCommit,
			getSelectionOffsets,
			applyMenuClipboard,
			readSnapAtPoint: widgetInteraction.readSnapAtPoint,
			insertMarkdown: clipboard.insertMarkdown,
			insertPlainText: clipboard.insertPlainText,
			claimRootClipboard: clipboard.claimRootClipboard,
			typeText: editableSurface.surface.typeText,
			afterSelectionRemoved: editableSurface.afterSelectionRemoved,
			landRestoredCaret: (offset: number) => widgetInteraction.restoreCaret(offset, 'reachable')
		} satisfies BlockComponent & LandsRestoredCaret;
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
		get reading() {
			return reading;
		},
		resolveLinkUrl,
		getTheme,
		getDocument: () => getDoc(),
		getContentVersion,
		navigateTo: (path) => rects.navigateTo(path),
		activationClick,
		get islands() {
			return decorationEngine ? decorationEngine.islandsForPath(myPath) : NO_ISLANDS;
		},
		reportRenderError: (error) =>
			editorEvents?.emit('error', { origin: 'render', error, context: { path: myPath } }),
		caretWriter,
		shownSource: () => shownSource.rangeIn(myPath, node)
	});

	$effect(() => {
		if (!el) return;
		cellRender.render({
			forceRebuild: pendingCursorOffset !== null,
			carryCaret: pendingCursorOffset === null
		});
		if (pendingCursorOffset !== null) {
			consumePendingRestore(el, pendingCursorOffset, (offset) =>
				widgetInteraction.restoreCaret(offset, 'exact')
			);
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

	function getRawFocusOffset(): RawOffset | null {
		return el ? rawSelectionFocus(el) : null;
	}

	// ── Event handlers ─────────────────────────────────────────────────────

	const onInput = editableSurface.onInput;
	// Callers guard `el` first.
	function cellPlanState(offset: number | null): CellKeyState {
		// A cell has no marker prefix, so these are raw offsets; they follow what is on screen,
		// not the mode, since a cell's move follows what the user sees.
		const bounds = landableDomTextBounds(el!);
		return {
			rowIdx,
			colIdx,
			columnCount,
			rowCount,
			offset,
			contentStart: bounds.start,
			contentEnd: bounds.end,
			collapsed: cursor.getRawSelection() === null,
			selectAllCount: selection.selectAllCount
		};
	}

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing || !el) return;

		// Reset before `cellKeydownPlan`: the shared reset runs only for keys the plan leaves to the
		// browser, so a key the plan takes would leave the select-all run active.
		if (endsSelectAllRun(e)) selection.resetSelectAllCount();

		// Must run before `cellKeydownPlan`, which takes arrows and calls `preventDefault`
		// without reaching here, leaving a live selection the next keystroke would replace.
		if (selection.isCrossBlock && (await crossBlock.handleKeyDown(e))) return;

		// The source-showing and selection handlers run before the plan, which would otherwise
		// read an ArrowUp or ArrowDown inside a shown source as cell navigation.
		if ((await widgetInteraction.handleRevealingKeydown(e)) || editableSurface.isDetached()) return;
		// Enter is a cell's exception: prose splits, a cell moves a row, and inside a shown source
		// Enter only leaves it, so the caret stays in the cell.
		if (widgetInteraction.isRevealing() && e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			widgetInteraction.foldRevealBeforeMutation();
			return;
		}
		if ((await widgetInteraction.handleSelectedWidgetKeydown(e)) || editableSurface.isDetached())
			return;

		const caretBeforeKey = cursor.getRaw();

		// Before the plan, whose edge branches ignore modifiers and would eat a column move. A move
		// from a cell moves the whole table, since a table's grid rows are not reorderable children.
		if (wiring.dispatchChord(e, keyTarget)) return;

		// Ahead of the plan, which reads an arrow at the cell's edge as a move to the next cell:
		// a construct closing the cell has a hidden edge to cross first.
		if (handleEdgeStep(e, sharedCtx)) return;

		const plan = cellKeydownPlan(e, cellPlanState(caretBeforeKey));

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
					startIntraTableRect(e.key, caretBeforeKey ?? 0)
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
				selectWholeDocument(selection, caretWriter, getDoc(), getBlockElByPath);
				return;
			default:
				e.preventDefault();
				await applyCellPlan(plan);
				return;
		}
	}

	// A shown source is hidden first: insert-row-below rebuilds every row from the cell raws and
	// would discard its edit. The caller calls `preventDefault`.
	async function applyCellPlan(plan: CellKeyPlan): Promise<void> {
		const fold = widgetInteraction.foldRevealBeforeMutation();
		if (fold) await fold.settled;
		switch (plan.kind) {
			case 'focus-cell':
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

	// Only at the cell's first or last visual line, so a wrapped cell extends its own text first,
	// as prose does. False falls through.
	function startIntraTableRect(key: 'ArrowUp' | 'ArrowDown', offset: number): boolean {
		if (!el) return false;
		const bounds = landableDomTextBounds(el);
		const atEdge =
			key === 'ArrowDown'
				? isAtLastVisualLine(el, offset, bounds, caretWriter)
				: isAtFirstVisualLine(el, offset, bounds, caretWriter);
		if (!atEdge) return false;

		const anchor = cellPoint(myPath.slice(0, -2), rowMajorCellIndex(rowIdx, colIdx, columnCount));
		return extendFromCell(
			{ selection, caretWriter, getDoc, reading, caretLanding },
			el,
			anchor,
			key
		);
	}

	function exitWithStickyX(direction: ExitDirection): void {
		if (!el) return;
		const x = getCurrentCursorEditorRelativeX(el, caretWriter) ?? 0;
		if (direction === 'up') tableContext.exitUpward(x);
		else tableContext.exitDownward(x);
	}

	function onBeforeInput(e: InputEvent): void {
		if (typedInput(e)) return;
		// A soft keyboard's line break, with no keydown, is the Shift+Enter command.
		if (e.inputType === 'insertLineBreak') {
			e.preventDefault();
			// Input, not a key, so it asks for the removal itself.
			editableSurface.afterSelectionRemoved(() => runCommand('cell.lineBreak'));
			return;
		}
	}

	/** GFM cells can't carry raw newlines, so a line break is a literal `<br>`, which the inline-HTML
	 *  pipeline renders as a live widget. */
	function writeLineBreak(): void {
		const offset = cursor.getRaw() ?? 0;
		const text = readCellText();
		const inserted = '<br>';
		void writeText({
			text: text.slice(0, offset) + inserted + text.slice(offset),
			caretAfter: offset + inserted.length,
			intent: 'typed',
			// Shift+Enter is a command, so its break is an undo step of its own.
			history: 'entry',
			mode: 'authored',
			source: 'cell-line-break'
		});
	}

	function onPointerDown(e: PointerEvent): void {
		if (!el) return;
		// The clear + drag-install below would collapse an active rectangle before
		// contextmenu fires, leaving the menu's Cut/Copy nothing to act on.
		if (e.button === 2) return;
		// A click on a widget that can show its source is this editor's gesture: cancel the
		// browser's caret default and skip the drag so nothing races its own placement.
		if (widgetInteraction.notePress(e)) {
			e.preventDefault();
			return;
		}
		const tableEl = el.closest('[role="table"]') as HTMLElement | null;
		if (tableEl && e.shiftKey && shiftClickFromAnotherCell(e, tableEl)) return;
		// Every other press goes through the shared handler, which places one in the cell's padding.
		crossBlock.handlePointerDown(e, tableEl && !e.shiftKey ? cellDrag(e, tableEl, el) : {});
	}

	function anchorIn(tableEl: HTMLElement): CellAnchor {
		return { tableEl, tablePath: myPath.slice(0, -2), rowIdx, colIdx, columnCount };
	}

	/** Shift+click with another cell of this table focused grows a cell rectangle from it. */
	function shiftClickFromAnotherCell(e: PointerEvent, tableEl: HTMLElement): boolean {
		const prev = cellCoordsOfElement(document.activeElement, tableEl);
		if (!prev || (prev.rowIdx === rowIdx && prev.colIdx === colIdx)) return false;
		resetForPointerDown(selection, caretWriter, caretMemory, true);
		handleCellShiftClick(
			selection,
			{ ...anchorIn(tableEl), rowIdx: prev.rowIdx, colIdx: prev.colIdx },
			{ rowIdx, colIdx }
		);
		e.preventDefault();
		return true;
	}

	/** A plain press in a cell runs the cell rectangle drag, not the cross-block one. */
	function cellDrag(
		e: PointerEvent,
		tableEl: HTMLElement,
		cellEl: HTMLElement
	): PointerPressOptions {
		return {
			ownDrag: (padding) => {
				const editorRoot = getEditorRoot();
				if (!editorRoot) return;
				installCellDragListener(
					{ editorRoot, selection, caretWriter, lifetimeSignal: editorLifetime },
					anchorIn(tableEl),
					e,
					padding && { surface: cellEl, press: padding }
				);
			}
		};
	}

	// A pasted grid (spreadsheet tabs or a GFM table) fills cells from the live rectangle's
	// top-left or this cell, growing the table; a whole-table selection still replaces.
	async function pasteGridHere(text: string): Promise<boolean> {
		const grid = parseClipboardGrid(text);
		if (!grid) return false;
		const tablePath = myPath.slice(0, -2);
		const cells = rangeCoverage()?.grid ?? null;
		if (cells && !pathsEqual(cells.path, tablePath)) return false;
		if (cells?.kind === 'table') return false;
		const rect = cells?.rect;
		const origin = rect ? { rowIdx: rect.top, colIdx: rect.left } : { rowIdx, colIdx };
		const fitted = rect ? tileGridTo(grid, rect.rows, rect.cols) : grid;
		if (rect) selection.collapse();
		await tableContext.pasteGrid(origin, fitted);
		return true;
	}

	// While a source is shown the DOM holds an edit `node.raw` has not seen, so a copy reads the
	// cell's live text.
	const clipboard = createTextClipboard({
		storedAs,
		get node() {
			return node;
		},
		get index() {
			return index;
		},
		get myPath() {
			return myPath;
		},
		cursor,
		surface: editableSurface,
		selection,
		setPendingCursor: parkCursor,
		foldRevealBeforeMutation: () => widgetInteraction.foldRevealBeforeMutation(),
		get reading() {
			return reading;
		},
		pastePreHook: pasteGridHere
	});
	const { onCopy, onCut, onPaste } = clipboard;

	// ── Right-click menu clipboard ──────────────────────────────────────────

	function getSelectionOffsets(): { start: number; end: number } | null {
		// A widget the editor holds selected is the selection the menu acts on, as a range is.
		const held = selection.widgetRange();
		if (held && pathsEqual(held.path, myPath)) return { start: held.start, end: held.end };
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
		// Right-click deliberately skips the pointerdown reset, so a source may still be showing
		// and `sel` was captured against that DOM, which is why it is hidden before anything else.
		const fold = widgetInteraction.foldRevealBeforeMutation();
		if (fold) await fold.settled;
		// A rectangle has no range inside one cell to restore: refocusing keeps it live in
		// `SelectionState`, where the cell's cut and copy find it.
		const hasRect = action !== 'paste' && !!rangeCoverage()?.grid;
		if (action !== 'paste' && !hasRect && sel.start === sel.end) return;
		// Clicking the menu item moved focus off the cell, so every branch refocuses before
		// mutating: execCommand needs the restored range, paste needs a focused caret.
		caretMemory.forget();
		el.focus({ preventScroll: true });
		if (action === 'paste') {
			const raw = await readClipboardText();
			// The cell can unmount while the read waits (a delete, a `source` swap).
			if (!el || !raw) return;
			// A live range stays as it is; otherwise the paste replaces what the menu was opened on.
			if (!selection.isCrossBlock) setSelection(sel.start, sel.end);
			// The same paste step Ctrl+V runs.
			await clipboard.insertMarkdown(raw);
			return;
		}
		if (!hasRect) setSelection(sel.start, sel.end);
		// The document's own command fires the clipboard event, so cut and copy run the cell's handlers.
		document.execCommand(action);
	}

	// A click past a widget leaves the caret with no text to sit in, so it moves to the
	// nearest widget edge.
	function onClick(e: MouseEvent): void {
		widgetInteraction.snapClickToWidgetEdge({
			click: e,
			clickCount: e.detail,
			// A release that travelled ends a drag, whose range a shown source would unmount.
			moved: presses.travelled(e)
		});
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
	class={['table-cell', ...blockDecorations.classes]}
	contenteditable={readOnly ? 'false' : 'true'}
	role={isHeaderRow ? 'columnheader' : 'cell'}
	style:text-align={alignment === 'none' ? undefined : alignment}
	oninput={onInput}
	onkeydown={editableSurface.onKeyDown}
	onbeforeinput={editableSurface.onBeforeInput}
	onpointerdown={onPointerDown}
	onclick={onClick}
	oncopy={onCopy}
	oncut={onCut}
	onpaste={onPaste}
	onfocus={onFocus}
	onblur={onBlur}
	oncompositionstart={editableSurface.onCompositionStart}
	oncompositionend={editableSurface.onCompositionEnd}
	{@attach editableSurface.registerSurface}
></div>

<style>
	/* The right and bottom only: the grid has no `border-collapse`, so the table draws the top
	   and left and every shared edge stays one line wide. */
	.table-cell {
		outline: none;
		padding: 4px 8px;
		min-height: 1.4em;
		white-space: pre-wrap;
		word-wrap: break-word;
		border-right: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
	}
	.table-cell:focus {
		outline: 2px solid var(--color-accent);
		outline-offset: -2px;
	}
</style>
