/**
 * What every contenteditable block and the `editable-leaf` factory share: cross-block wiring, the
 * shared keydown context, the BlockComponent caret methods, the element's attributes and its
 * empty-block hint, the one write to the block's own text, input, composition and clipboard
 * handling. Each block supplies a SurfaceBackend for its offsets; live state comes as functions.
 */

import { tick } from 'svelte';
import { createAttachmentKey } from 'svelte/attachments';
import type {
	BlockEditActions,
	ContentWrite,
	FocusActions,
	HistoryActions
} from '../../action-contracts';
import type { CaretLanding } from '../../selection/caret-landing';
import {
	CURSOR_EXACT_START,
	CURSOR_START,
	type StickyColumnDirection
} from '../../block-component';
import type { UserScrollport } from '../../windowing/scroll-ancestors';
import type { ScrollOwner } from '../../windowing/scroll-owner';
import type { BlockElLookup, DocumentGetter, PasteImageHook } from '../../editor-keys';
import { emitClipboardError, emitCommandError, type EditorEvents } from '../../editor-events';
import type { InlineMenuCombobox } from '../../inline-menu/inline-menu-state.svelte';
import type { NodeView } from '../../core/node-views';
import { blockAccessibleName } from '../../a11y-strings';
import type { CommandDispatchContext } from '../../schema/block-commands';
import type { PluginActivation } from '../../schema/plugin-activation';
import type { UndoController } from '../../editor-actions/deps';
import type { PasteCommitCoordinator } from '../../tree-operations/paste/paste-deps';
import type { CaretMemory } from '../../caret/caret-memory';
import type { SelectionState } from '../../selection/selection-state.svelte';
import { placeCaret, selectInBlock } from '../../selection/place-caret';
import { deleteSnapshot } from '../../selection/primitives';
import { asEditorX, asRawOffset, type RawOffset } from '../../caret/coordinate-spaces';
import type { SurfaceBackend } from '../../caret/surface-backend';
import type { DrawnCaret, WidgetEdgeSource } from '../../caret/drawn-caret.svelte';
import type { HeldInsertion } from '../../caret/next-insertion';
import type { TypedPlacement } from './text/edge-seat';
import { caretLook, type NextByte } from '../../caret/caret-look';
import type { InlineNode } from '../../core/nodes';
import { recordCaretLook } from '../../perf/instruments';
import { createNextByte } from './text/next-byte';
import type { BlockPendingBreak } from '../../caret/pending-break.svelte';
import type { HeldSpaceView } from '../../caret/held-space';
import { findOffsetNearestX } from '../../caret/sticky-measure';
import { measurePartialRectsInContentEditable } from '../../caret/overlay-rects';
import {
	documentLineEnding,
	normalizeLineEndings,
	trailingLineEnding,
	trimTrailingLineEnding,
	type LineEnding
} from '../../core/lines';
import type { KindCue } from '../kind-cue.svelte';
import type { BlockAutoPairs } from './text/auto-pair-record';
import { createSurfaceWrite, type TextWrite } from './surface-write';
import {
	createCrossBlockHandlers,
	type CrossBlockHandlers
} from '../../selection/cross-block/dispatch';
import { crossBlockClipboardArm } from '../../selection/cross-block/clipboard';
import {
	runClipboardCut,
	takeCopy,
	writeShownSelection,
	type ClipboardArm
} from './clipboard-step';
import { createImagePasteArm, type ImagePasteArm } from '../paste-image-arm';
import {
	rawOfWalkOffset,
	revealsNoMarkers,
	rawOffsetAt,
	walkOffsetOfRaw,
	type CaretWriter,
	type RawRange
} from '../../caret/widget-offset';
import type { SharedKeydownContext } from '../../selection/shared-keydown';
import {
	isInteractionTraceEnabled,
	traceCompositionEnd,
	traceCompositionStart,
	traceKeydownVerdict
} from '../../debug/interaction-trace';
import { assertInvariant } from '../../assert';
import { checkCompositionEndPaired } from '../../invariants/inline-transitions';
import type { Reading } from '../../schema/reading';
import { createPlaceholderHint, type PlaceholderPolicy } from './placeholder-hint.svelte';
import type { CompositionSeat } from './text/composition-seat';
import {
	reportDroppedComposition,
	type CompositionSignal
} from '../../editor-actions/dropped-composition';

// ── Keydown verdict ─────────────────────────────────────────────────────────

/** Records one trace decision per keydown once the handler's awaits finish: the e2e harness's
 *  only sign that a gesture which must change nothing is done. Disabled, one boolean read. */
function withKeydownVerdict(
	handle: (e: KeyboardEvent) => Promise<void>
): (e: KeyboardEvent) => void {
	return (e) => {
		if (!isInteractionTraceEnabled()) {
			void handle(e);
			return;
		}
		void handle(e).then(() => traceKeydownVerdict(e.key, e.defaultPrevented));
	};
}

// ── Selection removal ───────────────────────────────────────────────────────

/** Typed so a block can only answer with its own write, and the command over the selection waits
 *  until that write has landed. */
export type SelectionRemoval =
	ContentWrite | Promise<ContentWrite> | false | typeof REMOVED_IN_PLACE;

/** The answer of a block whose removal splices shown text in place, with no write to wait on. */
export const REMOVED_IN_PLACE = Symbol('removed-in-place');

// ── Accessibility attributes ────────────────────────────────────────────────

/** What an editable block tells assistive tech: its name, the inline menu's list while one shows
 *  in it, and the empty block's hint, which `data-placeholder` also hands the stylesheet. */
export interface EditableSurfaceAttributes {
	role: 'textbox' | 'combobox';
	'aria-label': string;
	'aria-expanded'?: 'true';
	'aria-controls'?: string;
	'aria-activedescendant'?: string;
	'aria-autocomplete'?: 'list';
	'aria-placeholder'?: string;
	'data-placeholder'?: string;
}

/** Applies `pending` only while `el` still holds focus, so a blur before the render drops it
 *  rather than pulling the selection back. The caller clears its pending field either way. */
export function consumePendingRestore<T>(
	el: HTMLElement | null,
	pending: T | null,
	apply: (value: T) => void
): boolean {
	if (pending === null) return false;
	const applied = document.activeElement === el;
	if (applied) apply(pending);
	return applied;
}

export interface EditableSurfaceDeps {
	getEl: () => HTMLElement | null;
	backend: SurfaceBackend;
	/** The raw range `focusAtColumn` searches, for a block whose first or last visual line takes
	 *  no caret (a code fence); the whole block when omitted. */
	columnWindow?: () => RawRange;
	/** What an offset handed to `focus` or `parkCaret` becomes before it lands. It receives the
	 *  `CURSOR_START`, `CURSOR_END` and `CURSOR_EXACT_START` values as they are. */
	clampLanding?: (offset: number) => number;
	/** True while an ephemeral edit (inline-math source reveal) owns the DOM: the block
	 *  commits on exit, so keyboard input and IME compositionend both skip the commit. */
	isInputSuppressed?: () => boolean;

	// ── Live block state (functions, never captured values) ───────────────────
	getNode: () => NodeView;
	getMyPath: () => number[];
	getIndex: () => number;
	getComposing: () => boolean;
	setComposing: (value: boolean) => void;
	/** Puts the caret at `at` once the next render lands, while the block still has focus. */
	requestCaret: (at: number, opts: { source: string }) => void;

	// ── Cross-block context ───────────────────────────────────────────────────
	selection: SelectionState;
	/** The editor's one writer of the native selection. */
	caretWriter: CaretWriter;
	/** The caret the editor draws, which this surface's element registers with while mounted. */
	drawnCaret: Pick<DrawnCaret, 'register'>;
	getDoc: DocumentGetter;
	getBlockElByPath: BlockElLookup;
	focusActions: FocusActions;
	/** Where a cross-block key's caret goes: a collapse, an extend's parked caret, a command's block. */
	caretLanding: Pick<CaretLanding, 'restore' | 'park' | 'mount'>;
	getEditorRoot: () => HTMLElement | null;
	/** What scrolls this editor (the root in self mode; the host's scroller or the window in
	 *  host mode), for the cross-block drag-select autoscroll. */
	getScrollHost: () => UserScrollport | null;
	/** Brings the block a Shift+Arrow extends into to the nearest edge. */
	scrollOwner: Pick<ScrollOwner, 'place'>;
	getEditorLifetime: () => AbortSignal | null;
	caretMemory: CaretMemory;
	blockEdit: BlockEditActions;
	controller: UndoController;
	history: HistoryActions;
	/** How this editor reads its bytes, for the cross-block join rules, the join-paste reparse and
	 *  the reading-mode check. */
	reading: Reading;
	/** The editor's command dispatch, which the keydown and cross-block handlers read. */
	commands: CommandDispatchContext;
	pasteCoordinator: PasteCommitCoordinator;
	/** The plugins this instance activated, forwarded to the paste-transform pipeline. */
	activePlugins: PluginActivation;
	/** This editor's events, for the cross-block clipboard's error reports. */
	events: EditorEvents;
	/** Names a new block kind a typed write made, in the modes that hide markers. */
	kindCue: KindCue;
	/** The `placeholder` prop as the editor hands it down, read live. */
	placeholder: () => PlaceholderPolicy | null;
	/** A prose block's view of the pair the auto-pair wrote; omitted where nothing pairs. */
	ownPairs?: BlockAutoPairs;

	// ── The per-block reads `SharedKeydownContext` needs ──────────────────────
	/** The selection's focus endpoint as a raw offset; each block converts its own DOM read. */
	getFocusOffset: () => RawOffset | null;
	getTextLen: () => number;
	/** A surface that hides inline markers crosses each hidden edge in a press of its own
	 *  (`text/edge-step.ts`); absent where no inline construct renders. */
	stepEdge?: SharedKeydownContext['stepEdge'];

	// ── Input handling (per block) ────────────────────────────────────────────
	/** Read the current DOM content as the block's displayed text, for the input commit. */
	readText: () => string;
	/** What a composition opened over (pending marks, a range), captured at its start and placing
	 *  the run it commits; omitted where a commit writes the text as read. */
	compositionSeat?: CompositionSeat;
	/** Where text typed at a hidden edge lands; omitted where the block draws every marker. Every
	 *  insertion route writes through its `insertion` (`next-insertion.ts`). */
	placement?: TypedPlacement;
	/** The block's inline tree, for a block whose text takes inline formats: the drawn caret shows
	 *  the ones the next letter would carry. */
	getInlines?: () => readonly InlineNode[];
	/** Runs before the shared input commit (the text block lets go of its widget edge here). */
	inputPrelude?: () => void;
	/** How the drawn caret draws beside this editable's inline widgets; absent where it has none. */
	widgetEdge?: WidgetEdgeSource;
	/** The block's own keydown handling, run after the surface records the pre-edit caret. */
	handleKeydown: (e: KeyboardEvent) => Promise<void>;
	/** Deletes `range` of the block's own text, leaving the caret at its start. */
	removeSelection?: (range: RawRange) => SelectionRemoval;
	/** An undo history the block keeps itself (a shown painted source), asked before the
	 *  editor's; true when it took the event. */
	localHistory?: (e: InputEvent) => boolean;
	/** The block's own beforeinput handling, run after the shared step, which it must not await. */
	handleBeforeInput?: (e: InputEvent) => void;
}

export interface EditableSurface {
	/** Spread on the editable element: its accessibility attributes, the empty block's hint, the
	 *  attachment that hint reads focus through, and the drawn caret's registration. */
	attributes(combobox: InlineMenuCombobox | null): EditableSurfaceAttributes & {
		[attachment: symbol]: unknown;
	};
	/** Registers the element with the drawn caret while it is mounted; `attributes` carries it, and
	 *  a surface that spreads no attributes attaches it on its own. */
	caretSource(el: HTMLElement): () => void;
	crossBlock: CrossBlockHandlers;
	sharedCtx: SharedKeydownContext;
	surface: EditableSurfaceMethods;
	caret: ClipboardCaretIO;
	/** True once this block's element has left the document. Svelte does not await a keydown
	 *  handler, so a container can unmount the block mid-await; each awaited step checks this. */
	isDetached(): boolean;
	/** Every edit the block makes to its own text: the input commit, and each key the block
	 *  writes for itself (`surface-write.ts`). */
	writeText(write: TextWrite): ContentWrite;
	/** The ending a line typed into the block takes: its own, else the document's. */
	lineEnding(): LineEnding;
	/** The line Shift+Enter at the block's end opened, which this block's next insertion spends. */
	pendingBreak: BlockPendingBreak;
	/** A space typed at a hidden closer here, which the next letter takes back inside. */
	heldSpace: HeldSpaceView;
	/** The formats a letter typed at raw offset `caret` would carry (`text/next-byte.ts`); plain
	 *  where the block has no `getInlines`. */
	nextByte(caret: number): NextByte;
	/** Wraps the block's `runCommand` (or a clipboard edit), so a command dispatched from
	 *  anywhere, a key or a toolbar, anchors undo on the caret it found. */
	command<A extends unknown[], R>(run: (...args: A) => R): (...args: A) => R;
	/** Removes the selection through `removeSelection`, then runs `run` at the caret it leaves: a
	 *  command target's `afterSelectionRemoved`, and how a line break typed as input replaces one. */
	afterSelectionRemoved(run: (removed: boolean) => boolean): boolean;
	/** Bound to the element's `keydown`. */
	onKeyDown: (e: KeyboardEvent) => void;
	/** Bound to the element's `beforeinput`: every input route fires it, keydown or not, so the
	 *  caret the undo entry restores is read here. */
	onBeforeInput: (e: InputEvent) => void;
	onInput: (e: Event) => void;
	/** The input commit for an edit the block spliced itself, which has no event to read. */
	commitInput: () => void;
	onCompositionStart: () => void;
	onCompositionEnd: () => void;
	/** The caret before the edit in progress: what an edit a block commits itself anchors on. */
	getPreEditOffset(): number;
	/** A shown source whose edits reach the node only on blur, for the empty-block hint to judge;
	 *  `read` runs only while the `placeholder` prop is set, and null forgets it as the source folds. */
	noteShownSource(read: (() => string) | null): void;
	/** Name the pre-edit caret for an edit the block splices itself rather than the browser. */
	notePreEditOffset(offset: number): void;
}

/**
 * The caret calls the shared clipboard code borrows from a block. `getEl` is a liveness
 * test: a host import hook can outlive the block that started the paste.
 */
export interface ClipboardCaretIO {
	getEl: () => HTMLElement | null;
	getCursorOffset: () => number | null;
	focus: (offset: number) => void;
	/** Reads the caret undo puts back after a cut or a paste, before a shown source hides. */
	recordPreEditOffset: () => void;
	/** The caret that record read. */
	getPreEditOffset: () => number;
	/** The selection, or the caret as an empty range; null when the block holds neither. */
	getSelection: () => RawRange | null;
	/** Takes what the caret memory keeps for this block's next insertion. */
	holdInsertion: () => HeldInsertion;
}

/** The BlockComponent methods shared verbatim across every editable surface. */
export interface EditableSurfaceMethods {
	focus(offset: number): void;
	/** Required here, optional on `BlockComponent`: an editable surface is what the
	 *  cross-block extend paths leave a caret in, so all of them go through here. */
	parkCaret(offset: number): void;
	focusAtColumn(x: number, from: StickyColumnDirection): void;
	getCursorOffset(): number | null;
	getSelectedText(): string;
	setSelection(start: number, end: number): void;
	measurePartialRects(startOffset: number, endOffset: number): DOMRect[];
	typeText(text: string, offset: number): Promise<boolean>;
}

export function createEditableSurface(deps: EditableSurfaceDeps): EditableSurface {
	const crossBlock = createCrossBlockHandlers({
		getEl: () => deps.getEl(),
		getMyPath: deps.getMyPath,
		selection: deps.selection,
		caretWriter: deps.caretWriter,
		getDoc: deps.getDoc,
		getBlockElByPath: deps.getBlockElByPath,
		caretLanding: deps.caretLanding,
		getEditorRoot: deps.getEditorRoot,
		getScrollHost: deps.getScrollHost,
		scrollOwner: deps.scrollOwner,
		getEditorLifetime: deps.getEditorLifetime,
		caretMemory: deps.caretMemory,
		blockEdit: deps.blockEdit,
		controller: deps.controller,
		reading: deps.reading,
		commands: deps.commands,
		pasteCoordinator: deps.pasteCoordinator,
		activePlugins: deps.activePlugins,
		events: deps.events
	});

	const sharedCtx: SharedKeydownContext = {
		getEl: () => deps.getEl(),
		getCursorOffset: () => deps.backend.getRaw(),
		getFocusOffset: deps.getFocusOffset,
		getTextLen: deps.getTextLen,
		stepEdge: deps.stepEdge,
		getMyPath: deps.getMyPath,
		getIndex: deps.getIndex,
		crossBlock,
		selection: deps.selection,
		caretWriter: deps.caretWriter,
		caretMemory: deps.caretMemory,
		history: deps.history,
		focus: deps.focusActions,
		getDoc: deps.getDoc,
		scrollOwner: deps.scrollOwner,
		commands: deps.commands,
		reading: deps.reading
	};

	// ── BlockComponent methods ────────────────────────────────────────────────

	/** Every caret placement from outside the block comes here, so offsets clamp to where a caret
	 *  can sit (`docs/design/live-mode.md` § 4.2 Typing at a hidden edge). */
	function parkCaret(offset: number): void {
		const el = deps.getEl();
		if (!el) return;
		// Placing a caret never scrolls; the caller that brings an off-screen target into view
		// does that itself.
		el.focus({ preventScroll: true });
		const landed = deps.clampLanding?.(offset) ?? offset;
		if (landed === CURSOR_EXACT_START) {
			deps.backend.setRaw(asRawOffset(0), { clamp: 'exact' });
			return;
		}
		const requested = landed === CURSOR_START ? 0 : Math.max(0, landed);
		deps.backend.setRaw(asRawOffset(requested), { clamp: 'reachable' });
	}

	const focus = placeCaret(deps.selection, deps.caretWriter, parkCaret);

	// A column placement stops on a painted glyph by measuring, so it writes its offset exact.
	function focusAtColumn(x: number, from: StickyColumnDirection): void {
		const el = deps.getEl();
		if (!el) return;
		el.focus({ preventScroll: true });
		const within = deps.columnWindow?.();
		// The default floor of raw 0 keeps the scan out of the container's marker prefix.
		const min = walkOffsetOfRaw(el, within?.start ?? 0);
		const max = within ? walkOffsetOfRaw(el, within.end) : undefined;
		const walkOffset = findOffsetNearestX(el, asEditorX(x), from, min, max);
		deps.backend.setRaw(rawOfWalkOffset(el, walkOffset), { clamp: 'exact' });
		// Announced like every other placement, but without `placeCaret`'s range clear: the
		// vertical move that gets here has already collapsed whatever range it left.
		deps.selection.announceSelection();
	}

	function getCursorOffset(): number | null {
		return deps.backend.getRaw();
	}

	function getSelectedText(): string {
		if (!deps.getEl()) return '';
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return '';
		return sel.toString();
	}

	function setSelection(start: number, end: number): void {
		const el = deps.getEl();
		if (el) {
			selectInBlock(deps.selection, deps.caretWriter, () =>
				deps.caretWriter.selectRawRange(el, start, end)
			);
		}
	}

	function measurePartialRects(startOffset: number, endOffset: number): DOMRect[] {
		const el = deps.getEl();
		if (!el) return [];
		return measurePartialRectsInContentEditable(
			el,
			walkOffsetOfRaw(el, startOffset),
			walkOffsetOfRaw(el, endOffset)
		);
	}

	// The write a typed character makes, for text typed over a range once the range is gone.
	function typeText(text: string, offset: number): Promise<boolean> {
		const display = trimTrailingLineEnding(deps.getNode().raw);
		preEditOffset = offset;
		return writeText({
			text: display.slice(0, offset) + text + display.slice(offset),
			caretAfter: offset + text.length,
			intent: 'typed',
			mode: 'authored',
			source: 'typed-over-range'
		});
	}

	const surface: EditableSurfaceMethods = {
		focus,
		parkCaret,
		focusAtColumn,
		getCursorOffset,
		getSelectedText,
		setSelection,
		measurePartialRects,
		typeText
	};

	// ── Input and composition ─────────────────────────────────────────────────

	const placeholder = createPlaceholderHint({
		policy: deps.placeholder,
		getNode: deps.getNode,
		getPath: deps.getMyPath,
		reading: deps.reading
	});

	// The caret before the edit, so undo puts it back there. A composition keeps the one read at
	// its start: Chromium fires the composition's own beforeinput events after that.
	let preEditOffset = 0;
	const recordPreEditOffset = (): void => {
		if (!deps.getComposing()) preEditOffset = deps.backend.getRaw() ?? 0;
	};

	// For a typed line break only: a rewrite of the block's own text keeps the ending it has
	// (`withOwnEnding`), since this one falls back to the document's.
	function lineEnding(): LineEnding {
		return trailingLineEnding(deps.getNode().raw, documentLineEnding(deps.getDoc()));
	}

	// This block's identity in the caret memory, so a record left here is spent only here.
	const block = {};
	const holdInsertion = (): HeldInsertion =>
		deps.caretMemory.holdInsertion(block, deps.placement?.insertion);
	const { getInlines } = deps;
	const nextByte = getInlines
		? createNextByte({
				getEl: deps.getEl,
				getNode: deps.getNode,
				getInlines,
				reading: deps.reading,
				caretMemory: deps.caretMemory,
				preview: () => deps.caretMemory.previewInsertion(block, deps.placement?.insertion),
				offsetFor: (caret, typed) => deps.placement?.offsetFor(caret, typed) ?? caret
			})
		: () => ({ marks: [] });

	const writeText = createSurfaceWrite({
		getNode: deps.getNode,
		getIndex: deps.getIndex,
		getPath: deps.getMyPath,
		blockEdit: deps.blockEdit,
		kindCue: deps.kindCue,
		getPreEditOffset: () => preEditOffset,
		requestCaret: deps.requestCaret,
		ownPairs: deps.ownPairs,
		holdInsertion
	});

	function command<A extends unknown[], R>(run: (...args: A) => R): (...args: A) => R {
		return function recorded(...args) {
			recordPreEditOffset();
			return run(...args);
		};
	}

	// A keydown that writes for itself fires no beforeinput, so the caret is read here too.
	const onKeyDown = withKeydownVerdict(async (e) => {
		endsDroppedComposition(e);
		if (!e.isComposing) recordPreEditOffset();
		await deps.handleKeydown(e);
	});

	// Synchronous to the block's handler: the block's `preventDefault` only counts inside this
	// listener's microtask checkpoint.
	function onBeforeInput(e: InputEvent): void {
		endsDroppedComposition(e);
		if (!e.isComposing) recordPreEditOffset();
		if (deps.localHistory?.(e) || runSharedBeforeInput(e)) return;
		deps.handleBeforeInput?.(e);
	}

	/** The browser's own Undo and Redo are the editor's, and a character typed over a range across
	 *  blocks replaces the range. True when the step took the event. */
	function runSharedBeforeInput(e: InputEvent): boolean {
		if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
			e.preventDefault();
			void (e.inputType === 'historyUndo'
				? deps.history.requestUndo()
				: deps.history.requestRedo());
			return true;
		}
		if (!crossBlock.claimsBeforeInput(e)) return false;
		void crossBlock.handleBeforeInput(e);
		return true;
	}

	function onInput(e: Event): void {
		if (!endsDroppedComposition(e)) commitDomRead(false);
	}

	function commitDomRead(fromComposition: boolean): void {
		// Held before `noteTyping` resets the caret's side, which places the insertion.
		const held = fromComposition ? heldForComposition : holdInsertion();
		if (fromComposition) heldForComposition = null;
		// Nothing reaches the text: a composition's records end with it, typing's wait on.
		const unwritten = () => held?.finish(fromComposition);
		if (deps.isInputSuppressed?.()) return unwritten();
		deps.inputPrelude?.();
		deps.caretMemory.noteTyping();
		const el = deps.getEl();
		if (deps.getComposing() || !el) return unwritten();
		const text = deps.readText();
		const savedOffset = deps.backend.getRaw() ?? 0;
		// A block that draws its delimiters keeps the reading verbatim, and so does a run composed
		// where a record waits, which is that record's insertion.
		const rewritten =
			fromComposition && revealsNoMarkers(el) && !held?.waitsAt(preEditOffset)
				? (deps.compositionSeat?.relocate(text, preEditOffset) ?? null)
				: null;
		void writeText({
			text: rewritten?.raw ?? text,
			caretAfter: rewritten?.caret ?? savedOffset,
			intent: 'typed',
			mode: 'authored',
			source: fromComposition ? 'composition' : 'input',
			...(rewritten ? { inPlace: true } : {}),
			...(held ? { held } : {})
		});
	}

	// Held from composition start, whose cross-block step forgets the caret memory, to the commit.
	let heldForComposition: HeldInsertion | null = null;

	function onCompositionStart(): void {
		if (!deps.getEl()) return;
		endsDroppedComposition('compositionstart');
		// Captured first: the cross-block step below clears the arrival side.
		deps.compositionSeat?.noteStart();
		traceCompositionStart();
		// Capture before `crossBlock.handleCompositionStart()`, whose delete moves the caret.
		preEditOffset = deps.backend.getRaw() ?? 0;
		heldForComposition?.finish(true);
		heldForComposition = holdInsertion();
		crossBlock.handleCompositionStart();
		deps.setComposing(true);
		placeholder.setComposing(true);
	}

	function onCompositionEnd(): void {
		// `onCompositionStart` always sets the flag, so an unpaired end means a consumer
		// wired compositionend without compositionstart (G1.27).
		assertInvariant('composition-window', () => checkCompositionEndPaired(deps.getComposing()));
		endComposition();
	}

	// Every signal a held composing flag is read at (a key, a beforeinput, an input, a new
	// composition) asks here first, so a composition the browser dropped ends before it is read.
	function endsDroppedComposition(signal: CompositionSignal): boolean {
		if (!reportDroppedComposition(signal, deps.getComposing())) return false;
		endComposition();
		return true;
	}

	// The browser's `compositionend`, or a signal showing the browser dropped the composition.
	function endComposition(): void {
		traceCompositionEnd();
		deps.setComposing(false);
		placeholder.setComposing(false);
		commitDomRead(true);
		crossBlock.handleCompositionEnd();
		deps.compositionSeat?.noteEnd();
	}

	const caret: ClipboardCaretIO = {
		getEl: deps.getEl,
		getCursorOffset,
		focus,
		recordPreEditOffset,
		getPreEditOffset: () => preEditOffset,
		getSelection: () => {
			const at = deps.backend.getRaw();
			return deps.backend.getRawSelection() ?? (at === null ? null : { start: at, end: at });
		},
		holdInsertion
	};

	// The element, not the binding: a torn-down host drops out of the document before Svelte's
	// `bind:this` teardown nulls the reference a resuming handler still holds.
	const isDetached = (): boolean => deps.getEl()?.isConnected !== true;

	function afterSelectionRemoved(run: (removed: boolean) => boolean): boolean {
		const range = deps.backend.getRawSelection();
		const remove = deps.removeSelection;
		if (!range || range.start === range.end || !remove) return run(false);
		const seed = deleteSnapshot(deps.getMyPath(), range.start);
		void deps.controller
			.undoStep(seed, async () => {
				const removal = remove(range);
				if (!(await (removal === REMOVED_IN_PLACE || removal))) return;
				// The command reads the caret the removal's render puts back.
				await tick();
				if (!isDetached()) run(true);
			})
			// Nothing awaits the key's step, so a throw in it reaches the host as a command's would.
			.catch((error: unknown) =>
				emitCommandError(deps.events, {
					kind: deps.getNode().kind,
					command: 'selection-removal',
					error
				})
			);
		return true;
	}

	// Taken once: Svelte re-runs an attachment only when the function under its key changes.
	const trackKey = createAttachmentKey();
	const caretSourceKey = createAttachmentKey();

	// A composition or a shown inline source owns the caret, so the browser's own shows then.
	const caretSource = (el: HTMLElement) =>
		deps.drawnCaret.register({
			el,
			drawable: () => !deps.getComposing() && !deps.isInputSuppressed?.(),
			widgetEdge: deps.widgetEdge,
			...(getInlines && {
				look: (range: Range) => {
					recordCaretLook('caretLookOffsetWalks');
					return caretLook(nextByte(rawOffsetAt(el, range.startContainer, range.startOffset)));
				}
			})
		});

	// The role is `combobox` only while inline menu rows show: `textbox` carries no
	// `aria-expanded`, so a screen reader would hear nothing about the list.
	function attributes(combobox: InlineMenuCombobox | null) {
		const hint = placeholder.text() ?? undefined;
		return {
			role: combobox ? ('combobox' as const) : ('textbox' as const),
			'aria-label': blockAccessibleName(deps.getNode()),
			'aria-expanded': combobox ? ('true' as const) : undefined,
			'aria-controls': combobox?.listboxId,
			'aria-activedescendant': combobox?.activeOptionId,
			'aria-autocomplete': combobox ? ('list' as const) : undefined,
			'aria-placeholder': hint,
			'data-placeholder': hint,
			[trackKey]: placeholder.track,
			[caretSourceKey]: caretSource
		};
	}

	return {
		attributes,
		caretSource,
		crossBlock,
		sharedCtx,
		surface,
		caret,
		isDetached,
		writeText,
		lineEnding,
		pendingBreak: deps.caretMemory.pendingBreak.forBlock(block),
		heldSpace: deps.caretMemory.heldSpace.forBlock(block),
		nextByte,
		command,
		afterSelectionRemoved,
		onKeyDown,
		onBeforeInput,
		onInput,
		commitInput: () => commitDomRead(false),
		onCompositionStart,
		onCompositionEnd,
		getPreEditOffset: () => preEditOffset,
		noteShownSource: (read) => {
			if (!read) placeholder.setShownSource(null);
			else if (deps.placeholder()) placeholder.setShownSource(read());
		},
		notePreEditOffset: (offset) => {
			preEditOffset = offset;
		}
	};
}

// ── Hiding a shown source ───────────────────────────────────────────────────

/**
 * What hiding a shown source hands back to the edit that triggered it. A commit that changes
 * the block's kind takes the structural path, whose completion is a promise, so an edit waits
 * on `settled` rather than on a tick that happens to outlast it.
 */
export interface RevealFold {
	/** The committed caret offset: where the edit left the caret. */
	caret: number;
	/** Resolves once that write has landed and its render has flushed. */
	settled: Promise<void>;
}

// ── Clipboard ───────────────────────────────────────────────────────────────

/**
 * The copy, cut and paste steps every editable block shares, in one order no block can
 * skip or reshuffle. Paste prevents the default before its first await, or the native paste runs
 * while a shown source hides. Everything goes through the event's synchronous `clipboardData`;
 * `navigator.clipboard` is permission-gated and unreliable in Tauri's webview.
 */
export interface ClipboardSurfaceDeps {
	caretMemory: CaretMemory;
	selection: SelectionState;
	getDoc: DocumentGetter;
	crossBlock: CrossBlockHandlers;
	/** Reading mode: copy/cut write the visible selection string, paste is inert. */
	isReadOnly: () => boolean;
	/** The block's caret calls, borrowed by the image branch to anchor its insertion. */
	caret: ClipboardCaretIO;
	/** This editor's events: the image branch's only way to report a host hook that
	 *  rejects. Required so a block cannot silently swallow a failed import. */
	events: EditorEvents;
	/** Host image-import hook from the policies context. Undefined leaves an
	 *  image-bearing paste on the text/plain path. */
	onPasteImage: PasteImageHook | undefined;
	/** Hides a shown inline source before a cut or paste mutates, so the mutation runs against a
	 *  CST that matches the DOM. Omit on a block that never shows source. */
	foldReveal?: () => RevealFold | null;
	/** Selections tried before a range across blocks: a selected widget. */
	selectionArms?: readonly ClipboardArm[];
	/** The block's own range, tried last. */
	rangeArm: ClipboardArm;
	/** The paste step before cross-block handling, given the normalised text while a rectangle is
	 *  readable (a grid into a table's cells). True when it consumed the paste. */
	pastePreHook?: (text: string) => boolean | Promise<boolean>;
	/** The intra-block paste, handed the normalized text and where the paste goes. */
	pasteTail: (pastedText: string, target: PasteTarget) => void | Promise<void>;
}

/** Where a paste goes, read as its event arrives: before a shown source hides, which moves the
 *  selection, and before the paste forgets the caret memory. */
export interface PasteTarget {
	/** The selection, or the caret as an empty range; null when the block holds neither. */
	range: RawRange | null;
	/** What the caret memory kept for this block's next insertion, held until the paste ends; an
	 *  inline paste spends it. */
	held: HeldInsertion;
}

export interface ClipboardHandlers {
	onCopy(e: ClipboardEvent): void;
	onCut(e: ClipboardEvent): Promise<void>;
	onPaste(e: ClipboardEvent): Promise<void>;
	/** Insert `md` as pasting it here would, for `EditorInstance.insertMarkdown`. Resolves once
	 *  the paste lands; false in reading mode or for an empty payload. */
	insertMarkdown(md: string): Promise<boolean>;
}

export function createClipboardHandlers(deps: ClipboardSurfaceDeps): ClipboardHandlers {
	const arms: readonly ClipboardArm[] = [
		...(deps.selectionArms ?? []),
		crossBlockClipboardArm({
			selection: deps.selection,
			getDoc: deps.getDoc,
			crossBlock: deps.crossBlock
		}),
		deps.rangeArm
	];
	const imageArm = createImagePasteArm({
		onPasteImage: deps.onPasteImage,
		events: deps.events,
		crossBlock: deps.crossBlock
	});

	function onCopy(e: ClipboardEvent): void {
		deps.caretMemory.forget();
		e.preventDefault();
		// Reading mode, and a copy no `ClipboardArm` takes, copy what the user sees.
		if (deps.isReadOnly() || takeCopy(e, arms) === null) writeShownSelection(e);
	}

	function onCut(e: ClipboardEvent): Promise<void> {
		if (deps.isReadOnly()) {
			onCopy(e);
			return Promise.resolve();
		}
		deps.caretMemory.forget();
		deps.caret.recordPreEditOffset();
		return runClipboardCut(e, arms, deps.foldReveal);
	}

	/** Undo's caret, the target and what the next insertion spends, all read before the first
	 *  await: a shown source hides on the way, and its commit forgets the caret memory. */
	function readPasteTarget(): PasteTarget {
		deps.caret.recordPreEditOffset();
		return { range: deps.caret.getSelection(), held: deps.caret.holdInsertion() };
	}

	async function onPaste(e: ClipboardEvent): Promise<void> {
		e.preventDefault();
		if (deps.isReadOnly()) return;
		const target = readPasteTarget();
		try {
			// Read `clipboardData` before the first await, while the event still holds it.
			const images = imageArm.filesOf(e.clipboardData);
			if (images.length === 0) {
				const text = normalizeLineEndings(e.clipboardData?.getData('text/plain') ?? '');
				await insertPastedText(text, e, target);
				return;
			}
			await deps.foldReveal?.()?.settled;
			deps.caretMemory.forget();
			await pasteImages(deps, imageArm, e, images, target);
		} finally {
			target.held.finish(true);
		}
	}

	/** Everything a plain-text paste does, shared by the gesture and the API call; `e` is null
	 *  when there is no gesture to consume. */
	async function insertPastedText(
		text: string,
		e: ClipboardEvent | null,
		target: PasteTarget
	): Promise<void> {
		await deps.foldReveal?.()?.settled;
		if (text && deps.pastePreHook && (await deps.pastePreHook(text))) return;
		if (await deps.crossBlock.handlePaste(e, text)) return;
		deps.caretMemory.forget();
		if (!text) return;
		await deps.pasteTail(text, target);
	}

	async function insertMarkdown(md: string): Promise<boolean> {
		if (deps.isReadOnly()) return false;
		const text = normalizeLineEndings(md);
		if (!text) return false;
		const target = readPasteTarget();
		try {
			await insertPastedText(text, null, target);
		} finally {
			target.held.finish(true);
		}
		return true;
	}

	return { onCopy, onCut, onPaste, insertMarkdown };
}

// ── Pasting an image ────────────────────────────────────────────────────────

/** The part of an image paste that needs a caret. The target was read as the event arrived, so a
 *  slow import cannot follow a caret the user moved meanwhile. */
async function pasteImages(
	deps: ClipboardSurfaceDeps,
	imageArm: ImagePasteArm,
	e: ClipboardEvent,
	images: File[],
	target: PasteTarget
): Promise<void> {
	const anchor = target.range?.start ?? 0;
	const text = await imageArm.run(e, images);
	if (text === null) return;
	// A hook slow enough to outlive its block leaves nothing to insert into, and the
	// paste tails would fall back to offset 0. Decline, loudly.
	if (!deps.caret.getEl()) {
		emitClipboardError(deps.events, {
			error: new Error('onPasteImage resolved after its block was gone; insertion declined')
		});
		return;
	}
	// Move the caret only if it drifted: placing one collapses the DOM range the block reads its
	// replaced span from, and this paste would stop replacing the selection.
	if (deps.caret.getCursorOffset() !== anchor) deps.caret.focus(anchor);
	await deps.pasteTail(text, target);
}
