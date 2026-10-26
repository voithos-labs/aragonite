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
} from '../../../action-contracts';
import type { CaretLanding } from '../../../selection/caret-landing';
import {
	CURSOR_EXACT_START,
	CURSOR_START,
	type StickyColumnDirection
} from '../../../block-component';
import type { UserScrollport } from '../../../windowing/scroll-ancestors';
import type { DocumentGetter } from '../../../editor-keys';
import type { BlockElLookup } from '../../../caret/block-el-lookup';
import type { PasteImageHook } from '../../../host-hooks';
import { emitCommandError, type EditorEvents } from '../../../editor-events';
import type { InlineMenuCombobox } from '../../../inline-menu/inline-menu-state.svelte';
import type { NodeView } from '../../../core/node-views';
import { blockAccessibleName, readingRole } from '../../../a11y-strings';
import type { ReadingFocus } from '../../editor-root/reading-focus.svelte';
import type { ScrollOwner } from '../../../windowing/scroll-owner';
import {
	dispatchKeyCommand,
	type CommandDispatchContext,
	type KindCommandTarget
} from '../../../schema/block-commands';
import { eventToChord } from '../../../schema/keybindings';
import type { PluginActivation } from '../../../schema/plugin-activation';
import type { UndoController } from '../../../editor-actions/deps';
import type { PasteCommitCoordinator } from '../../../tree-operations/paste/paste-deps';
import type { CaretMemory } from '../../../caret/caret-memory';
import type { SelectionState } from '../../../selection/selection-state.svelte';
import { placeCaret, selectInBlock } from '../../../selection/place-caret';
import { deleteSnapshot } from '../../../selection/primitives';
import { asEditorX, asRawOffset, type RawOffset } from '../../../caret/coordinate-spaces';
import type { SurfaceBackend } from './surface-backend';
import type { DrawnCaret, WidgetEdgeSource } from '../../../caret/drawn-caret.svelte';
import type { HeldInsertion } from '../../../caret/next-insertion';
import type { TypedPlacement } from '../text/edge-seat';
import { caretLook, type NextByte } from '../../../caret/caret-look';
import type { InlineNode } from '../../../core/nodes';
import { recordCaretLook } from '../../../perf/instruments';
import { createNextByte } from '../text/next-byte';
import type { BlockPendingBreak } from '../../../caret/pending-break.svelte';
import type { HeldSpaceView } from '../../../caret/held-space';
import type { InsideCloserView } from '../../../caret/inside-closer';
import type { BlockPendingMarks } from '../../../caret/pending-marks';
import { findOffsetNearestX } from '../../../caret/sticky-measure';
import { measurePartialRectsInContentEditable } from '../../overlays/rects';
import {
	documentLineEnding,
	trailingLineEnding,
	trimTrailingLineEnding,
	type LineEnding
} from '../../../core/lines';
import { keepLineEndingPairs, lineEndingPairBeside } from '../../../core/line-ending-pairs';
import { getContentRange, isProseKind, sameLineSuffix } from '../../../core/inline';
import { droppedOpenLines } from '../../../tree-operations/content-write';
import type { KindCue } from '../../kind-cue.svelte';
import type { BlockAutoPairs } from '../text/auto-pair-record';
import { createSurfaceWrite, type TextWrite } from './surface-write';
import {
	createCrossBlockHandlers,
	type CrossBlockHandlers
} from '../../../selection/cross-block/dispatch';
import {
	createClipboardHandlers,
	type BlockClipboard,
	type ClipboardCaretIO,
	type ClipboardHandlers,
	type InlinePaste,
	pasteIntoBlock
} from './surface-clipboard';
import { shownSelectionText } from './clipboard-step';
import {
	rawOfWalkOffset,
	revealsNoMarkers,
	rawOffsetAt,
	walkOffsetOfRaw,
	type CaretClamp,
	type CaretWriter,
	type RawRange
} from '../../../caret/widget-offset';
import {
	caretLandableBounds,
	type CaretUnitSource,
	type SharedKeydownContext
} from '../../../selection/shared-keydown';
import {
	isInteractionTraceEnabled,
	traceCompositionEnd,
	traceCompositionStart,
	traceKeydownVerdict
} from '../../../debug/interaction-trace';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { checkRepaintReadsTree } from '../../../invariants/repaint-reads-tree';
import { checkCompositionEndPaired } from '../../../invariants/inline-transitions';
import { checkDeleteDecided } from '../../../invariants/collapsed-delete';
import type {
	DeleteAnswer,
	DeleteDirection,
	DeleteIntent,
	DeleteVerdict
} from '../../../caret/delete-extent';
import {
	decideCollapsedDelete,
	decideDeleteChord,
	type CollapsedDeleteReads
} from './collapsed-delete';
import type { Reading } from '../../../schema/reading';
import { createPlaceholderHint, type PlaceholderPolicy } from '../placeholder-hint.svelte';
import type { CompositionSeat } from '../text/composition-seat';
import {
	opensComposition,
	reportDroppedComposition,
	type CompositionSignal
} from '../../../editor-actions/dropped-composition';

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
 *  in it, and the empty block's hint, which `data-placeholder` also hands the stylesheet. Reading
 *  mode drops the field's role and name: a heading reads as a heading, any other block as text. */
export interface EditableSurfaceAttributes {
	role?: 'textbox' | 'combobox' | 'heading';
	'aria-label'?: string;
	'aria-level'?: number;
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
	/** True while an ephemeral edit (a painted leaf's source) owns the DOM: the block
	 *  commits on exit, so keyboard input and IME compositionend both skip the commit. */
	isInputSuppressed?: () => boolean;
	/** True while a widget in the block shows its source: typing there writes its bytes, and the
	 *  line completion a typed write runs (`$$` to a fence) stays off. */
	showsSource?: () => boolean;
	/** Where `focus` and `parkCaret` put a caret once clamped: a prose block opens the source of a
	 *  widget the offset falls strictly inside, a block with no inline widgets writes it. */
	landCaret: (offset: number, clamp: CaretClamp) => void;

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
	/** Where a cross-block key's caret goes: a collapse, an extended end, a command's block. */
	caretLanding: Pick<CaretLanding, 'restore' | 'mount' | 'showSelectionEnd'>;
	getEditorRoot: () => HTMLElement | null;
	/** What scrolls this editor (the root in self mode; the host's scroller or the window in
	 *  host mode), for the cross-block drag-select autoscroll. */
	getScrollHost: () => UserScrollport | null;
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
	/** This editor's events, for the clipboard's error reports. */
	events: EditorEvents;
	/** Host image-import hook from the policies context, read at each paste. */
	onPasteImage: () => PasteImageHook | undefined;
	/** Names a new block kind a typed write made, in the modes that hide markers. */
	kindCue: KindCue;
	/** The `placeholder` prop as the editor hands it down, read live. */
	placeholder: () => PlaceholderPolicy | null;
	/** A prose block's view of the pair the auto-pair wrote; omitted where nothing pairs. */
	ownPairs?: BlockAutoPairs;
	/** The editor's reading-mode tab stop, which the element takes its tabindex from, and the caret
	 *  reading mode stands in for, which a Shift+click grows from. */
	readingFocus: Pick<ReadingFocus, 'hold' | 'focusCaret'>;
	/** What the editor shows, for an arrow in a block taller than that with no caret, and where a
	 *  page key steps to. */
	scrollOwner: Pick<ScrollOwner, 'port' | 'visibleBand' | 'showRect' | 'pathAt'>;

	// ── The per-block reads `SharedKeydownContext` needs ──────────────────────
	/** The selection's focus endpoint as a raw offset; each block converts its own DOM read. */
	getFocusOffset: () => RawOffset | null;
	getTextLen: () => number;
	/** A surface that hides inline markers crosses each hidden edge in a press of its own
	 *  (`text/edge-step.ts`); absent where no inline construct renders. */
	stepEdge?: SharedKeydownContext['stepEdge'];
	/** The inline spans a horizontal arrow crosses whole (widgets, replace decorations), read at
	 *  the key; absent where no inline widget renders. A CRLF pair is the surface's own. */
	inlineUnits?: () => CaretUnitSource;

	// ── Input handling (per block) ────────────────────────────────────────────
	/** Read the current DOM content as the block's displayed text, for the input commit. */
	readText: () => string;
	/** The same read with a caret in the shown bytes moved onto it; absent where the read is the
	 *  shown bytes as they are. */
	readInput?: (caret: number) => { text: string; caret: number };
	/** Rebuild the element from the block's bytes, for an input the tree took back after the
	 *  browser had already drawn it. */
	repaint: () => void;
	/** The selection a composition opened over, captured at its start, which the run it commits
	 *  replaces; omitted where a commit writes the text as read. */
	compositionSeat?: CompositionSeat;
	/** Where an insertion at a hidden edge lands and how a pending mark wraps it, for every route's
	 *  write (`next-insertion.ts`); omitted where the block draws every marker. */
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
	/** Takes what a collapsed delete at raw `caret` aims at, through the block's own text. Omitted
	 *  where the browser's delete is read back. */
	deleteAtCaret?: (caret: number, intent: DeleteIntent) => DeleteAnswer;
	/** Takes or enters the widget or decoration a delete of any unit facing `direction` meets at raw
	 *  `caret`; true when it did. Omitted, like `deleteAtCaret`, where the block draws no widgets. */
	deleteBeside?: (caret: number, direction: DeleteDirection) => boolean;
	/** What the block's keys run at, for a delete at its edge, which runs the plain key's binding. */
	commandTarget?: () => KindCommandTarget;
	/** The block's own handling of a delete the editor left to the browser (a range, a soft
	 *  keyboard's wider edit, one `deleteAtCaret` declined), run before the browser's would. */
	handleDeclinedDelete?: (e: InputEvent) => void;
}

export interface EditableSurface {
	/** Spread on the editable element: its accessibility attributes, the empty block's hint, the
	 *  attachment that hint reads focus through, and `registerSurface`. */
	attributes(combobox: InlineMenuCombobox | null): EditableSurfaceAttributes & {
		[attachment: symbol]: unknown;
	};
	/** Registers the element with the drawn caret and the reading-mode tab stop while it is
	 *  mounted; `attributes` carries it, and a surface that spreads none attaches it on its own. */
	registerSurface(el: HTMLElement): () => void;
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
	/** The block's edit actions, its content writes keeping the open line a write leaves the caret on. */
	blockEdit: BlockEditActions;
	/** The ending a line typed into the block takes: its own, else the document's. */
	lineEnding(): LineEnding;
	/** The line Shift+Enter at the block's end opened, which this block's next insertion spends. */
	pendingBreak: BlockPendingBreak;
	/** Opens `lines` lines past the end of the block's text, as Shift+Enter there does; the offset
	 *  the open line's caret sits at. */
	openBreakAtEnd(lines: number): number;
	/** A space typed at a hidden closer here, which the next letter takes back inside. */
	heldSpace: HeldSpaceView;
	/** The caret Edit link left before a hidden closer here, which types inside the URL. */
	insideCloser: InsideCloserView;
	/** The marks a format chord at a collapsed caret here promised the block's next insertion. */
	pendingMarks: BlockPendingMarks;
	/** The formats a letter typed at raw offset `caret` would carry (`text/next-byte.ts`); plain
	 *  where the block has no `getInlines`. */
	nextByte(caret: number): NextByte;
	/** The block's copy, cut and paste handlers: the shared steps, given what only the block knows. */
	clipboard(block: BlockClipboard): ClipboardHandlers;
	/** Pastes into the block's own text through the paste dispatch, then puts the caret where the
	 *  paste left it. */
	pasteInline(paste: InlinePaste): Promise<void>;
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
		standInCaret: () => deps.readingFocus.focusCaret(),
		getDoc: deps.getDoc,
		getBlockElByPath: deps.getBlockElByPath,
		caretLanding: deps.caretLanding,
		getEditorRoot: deps.getEditorRoot,
		getScrollHost: deps.getScrollHost,
		scroll: deps.scrollOwner,
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

	const caretUnits: CaretUnitSource = {
		beside: (offset, direction, extending) =>
			deps.inlineUnits?.().beside(offset, direction, extending) ??
			// Most blocks hold no `\r`, so the DOM read stays off their arrows.
			(deps.getNode().raw.includes('\r')
				? lineEndingPairBeside(deps.readText(), offset, direction)
				: null),
		crossed: () => deps.inlineUnits?.().crossed()
	};

	const sharedCtx: SharedKeydownContext = {
		getEl: () => deps.getEl(),
		getCursorOffset: () => deps.backend.getRaw(),
		getFocusOffset: deps.getFocusOffset,
		getTextLen: deps.getTextLen,
		stepEdge: deps.stepEdge,
		caretUnits,
		getMyPath: deps.getMyPath,
		getIndex: deps.getIndex,
		crossBlock,
		selection: deps.selection,
		caretWriter: deps.caretWriter,
		caretMemory: deps.caretMemory,
		history: deps.history,
		focus: deps.focusActions,
		getDoc: deps.getDoc,
		caretLanding: deps.caretLanding,
		commands: deps.commands,
		reading: deps.reading,
		scroll: deps.scrollOwner
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
		deps.landCaret(requested, 'reachable');
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
		return deps.getEl() ? shownSelectionText() : '';
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
			history: 'join-typing',
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
	const pendingMarks = deps.caretMemory.pendingMarks.forBlock(block);
	const pendingBreak = deps.caretMemory.pendingBreak.forBlock(block);

	function openBreakAtEnd(lines: number): number {
		const node = deps.getNode();
		const textEnd = getContentRange(node).end;
		const line = { textEnd, lineEnd: textEnd + sameLineSuffix(node).length, ending: lineEnding() };
		for (let i = 0; i < lines; i++) pendingBreak.open(line);
		return line.lineEnd;
	}
	// A write that drops the empty lines after a final hard break, leaving the caret on them, keeps
	// them open the way Shift+Enter opened them, whichever route in the block wrote it.
	const blockEdit: BlockEditActions = {
		...deps.blockEdit,
		updateBlockContent(index, text, mode, history, preEditOffset, caret) {
			const open = droppedOpenLines(deps.getNode(), text);
			const written = deps.blockEdit.updateBlockContent(
				index,
				text,
				mode,
				history,
				preEditOffset,
				caret
			);
			if (open && caret === open.end && written.admitted) {
				void written.then((wrote) => wrote && openBreakAtEnd(open.lines));
			}
			return written;
		}
	};
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
				preview: () => deps.caretMemory.previewInsertion(block, deps.placement?.insertion)
			})
		: () => ({ marks: [] });

	const writeText = createSurfaceWrite({
		getNode: deps.getNode,
		getIndex: deps.getIndex,
		getPath: deps.getMyPath,
		blockEdit,
		kindCue: deps.kindCue,
		getPreEditOffset: () => preEditOffset,
		requestCaret: deps.requestCaret,
		ownPairs: deps.ownPairs,
		holdInsertion,
		showsSource: deps.showsSource
	});

	function command<A extends unknown[], R>(run: (...args: A) => R): (...args: A) => R {
		return function recorded(...args) {
			recordPreEditOffset();
			return run(...args);
		};
	}

	// The Enter keydown whose handler is still running, which decides that key's break itself.
	let enterKeydown: KeyboardEvent | null = null;
	// The last Backspace or Delete keydown, whose input the next delete is unless a handler took it.
	let deleteKeydown: KeyboardEvent | null = null;
	// The delete step's verdict on the input in progress, which the `input` after it checks.
	let deleteVerdict: DeleteVerdict | null = null;

	const deleteReads: CollapsedDeleteReads = {
		composing: deps.getComposing,
		caret: () => deps.backend.getRaw(),
		hasRange: () => deps.backend.getRawSelection() !== null,
		text: deps.readText,
		targetRange: (e) => {
			const target = typeof e.getTargetRanges === 'function' ? e.getTargetRanges()[0] : undefined;
			return target ? deps.backend.rawRangeOf(target) : null;
		},
		deleteAtCaret: deps.deleteAtCaret
			? (caret, intent) => {
					deps.inputPrelude?.();
					return deps.deleteAtCaret!(caret, intent);
				}
			: undefined,
		deleteBeside: deps.deleteBeside
			? (caret, direction) => {
					deps.inputPrelude?.();
					return deps.deleteBeside!(caret, direction);
				}
			: undefined,
		atEdge: (caret, direction) => {
			const el = deps.getEl();
			if (!el) return false;
			const bounds = caretLandableBounds(sharedCtx, el);
			return direction === 'backward' ? caret <= bounds.start : caret >= bounds.end;
		},
		runPlainKey: (key) => {
			const target = deps.commandTarget?.();
			if (target) dispatchKeyCommand(key, target, deps.commands);
		}
	};

	// A keydown that writes for itself fires no beforeinput, so the caret is read here too.
	const onKeyDown = withKeydownVerdict(async (e) => {
		endsDroppedComposition(e);
		// A key can outrun the `selectionchange` that moves a caret the browser left off its spot, and
		// every handler below reads the caret.
		const el = deps.getEl();
		if (!e.isComposing && el) deps.caretWriter.canonicalizeCaret(el);
		if (!e.isComposing) recordPreEditOffset();
		if (e.key === 'Enter' && !e.isComposing) enterKeydown = e;
		deleteKeydown = !e.isComposing && (e.key === 'Backspace' || e.key === 'Delete') ? e : null;
		try {
			await deps.handleKeydown(e);
			if (deleteKeydown === e) decideDeleteChord(e, deleteReads);
		} finally {
			if (enterKeydown === e) enterKeydown = null;
		}
	});

	/** A break input that arrives while its Enter's handler still runs is that key's default, which
	 *  the handler replaces, so it writes nothing (Playwright's Firefox fires it before the await). */
	function isEnterDefault(e: InputEvent): boolean {
		const isBreak = e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph';
		return isBreak && enterKeydown !== null;
	}

	// Synchronous to the block's handler: the block's `preventDefault` only counts inside this
	// listener's microtask checkpoint.
	function onBeforeInput(e: InputEvent): void {
		const keyChord =
			deleteKeydown && !deleteKeydown.defaultPrevented ? eventToChord(deleteKeydown) : null;
		deleteKeydown = null;
		// A step below that claims the input leaves it this verdict; the delete step overwrites it.
		deleteVerdict = { decided: false, decline: 'claimed' };
		endsDroppedComposition(e);
		adoptsComposition(e);
		// A drop's text lands at the pointer, not at the caret a chord promised its marks to.
		if (e.inputType === 'insertFromDrop') pendingMarks.end();
		if (isEnterDefault(e)) {
			e.preventDefault();
			return;
		}
		if (!e.isComposing) recordPreEditOffset();
		if (deps.localHistory?.(e) || runSharedBeforeInput(e)) return;
		deps.handleBeforeInput?.(e);
		if (e.defaultPrevented) return;
		deleteVerdict = decideCollapsedDelete(e, keyChord, deleteReads);
		if (deleteVerdict && !deleteVerdict.decided) deps.handleDeclinedDelete?.(e);
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
		const verdict = deleteVerdict;
		deleteVerdict = null;
		if (e instanceof InputEvent && !e.isComposing && !deps.getComposing()) {
			assertInvariant('collapsed-delete-decided', () => checkDeleteDecided(e.inputType, verdict));
		}
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
		const shownCaret = deps.backend.getRaw() ?? 0;
		const read = deps.readInput?.(shownCaret) ?? { text: deps.readText(), caret: shownCaret };
		const { text, caret: savedOffset } = keepLineEndingPairs(
			trimTrailingLineEnding(deps.getNode().raw),
			read.text,
			read.caret
		);
		// A block that draws its delimiters keeps the reading verbatim, and so does a run composed
		// where a record waits, which is that record's insertion.
		const rewritten =
			fromComposition && revealsNoMarkers(el) && !held?.waitsAt(preEditOffset)
				? (deps.compositionSeat?.relocate(text) ?? null)
				: null;
		const written = writeText({
			text: rewritten?.raw ?? text,
			caretAfter: rewritten?.caret ?? savedOffset,
			intent: 'typed',
			history: 'join-typing',
			mode: 'authored',
			source: fromComposition ? 'composition' : 'input',
			...(rewritten ? { inPlace: true } : {}),
			...(held ? { held } : {})
		});
		// The browser already changed the element, so a write the tree took back leaves that change
		// on screen until the block repaints from its bytes.
		if (written.admitted) {
			void written.then(
				(wrote) => wrote || repaintFromTree(),
				(error: unknown) => {
					repaintFromTree();
					throw error;
				}
			);
		}
	}

	function repaintFromTree(): void {
		deps.repaint();
		assertInvariant('repaint-reads-tree', () =>
			checkRepaintReadsTree(deps.readText(), trimTrailingLineEnding(deps.getNode().raw))
		);
	}

	// Held from the composition's opening to its commit.
	let heldForComposition: HeldInsertion | null = null;

	function onCompositionStart(): void {
		if (!deps.getEl()) return;
		endsDroppedComposition('compositionstart');
		traceCompositionStart();
		// A range across blocks goes first, and whichever block its removal leaves the caret in opens
		// the composition at its first update.
		if (!crossBlock.handleCompositionStart()) openComposition();
	}

	// The records the run spends are held before the caret memory forgets.
	function openComposition(): void {
		deps.compositionSeat?.noteStart();
		preEditOffset = deps.backend.getRaw() ?? 0;
		heldForComposition?.finish(true);
		heldForComposition = holdInsertion();
		deps.caretMemory.forget();
		deps.setComposing(true);
		placeholder.setComposing(true);
	}

	// No composition open here means a range across blocks claimed the start. This block holds
	// the caret its removal left, so it opens the composition before the first run lands.
	function adoptsComposition(e: InputEvent): void {
		if (opensComposition(e, deps.getComposing())) openComposition();
	}

	function onCompositionEnd(): void {
		// A composition opens at its start or at its first run, so an unpaired end means a consumer
		// wired compositionend without compositionstart.
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

	function clipboard(block: BlockClipboard): ClipboardHandlers {
		return createClipboardHandlers({
			caretMemory: deps.caretMemory,
			selection: deps.selection,
			getDoc: deps.getDoc,
			crossBlock,
			isReadOnly: () => deps.reading.mode() === 'reading',
			caret,
			events: deps.events,
			onPasteImage: deps.onPasteImage,
			endTypingBurst: () => deps.controller.flushDebouncedCheckpoint(),
			readsMarkdown: () => isProseKind(deps.getNode().kind),
			...block
		});
	}

	const pasteInline = (paste: InlinePaste): Promise<void> =>
		pasteIntoBlock(
			{
				getMyPath: deps.getMyPath,
				getDoc: deps.getDoc,
				blockEdit,
				controller: deps.pasteCoordinator,
				reading: deps.reading,
				activePlugins: deps.activePlugins,
				requestCaret: deps.requestCaret
			},
			paste
		);

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
	const registerKey = createAttachmentKey();

	function registerSurface(el: HTMLElement): () => void {
		const releaseStop = deps.readingFocus.hold(el, deps.getMyPath);
		const releaseCaret = caretSource(el);
		return () => {
			releaseCaret();
			releaseStop();
		};
	}

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
		const attachments = { [trackKey]: placeholder.track, [registerKey]: registerSurface };
		if (deps.reading.mode() === 'reading') {
			return { ...readingRole(deps.getNode()), 'data-placeholder': hint, ...attachments };
		}
		return {
			role: combobox ? ('combobox' as const) : ('textbox' as const),
			'aria-label': blockAccessibleName(deps.getNode()),
			'aria-expanded': combobox ? ('true' as const) : undefined,
			'aria-controls': combobox?.listboxId,
			'aria-activedescendant': combobox?.activeOptionId,
			'aria-autocomplete': combobox ? ('list' as const) : undefined,
			'aria-placeholder': hint,
			'data-placeholder': hint,
			...attachments
		};
	}

	return {
		attributes,
		registerSurface,
		crossBlock,
		sharedCtx,
		surface,
		caret,
		isDetached,
		writeText,
		blockEdit,
		lineEnding,
		pendingBreak,
		openBreakAtEnd,
		heldSpace: deps.caretMemory.heldSpace.forBlock(block),
		insideCloser: deps.caretMemory.insideCloser.forBlock(block),
		pendingMarks,
		nextByte,
		clipboard,
		pasteInline,
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
