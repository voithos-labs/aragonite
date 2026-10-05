/**
 * What every contenteditable block and the `editable-leaf` factory share: cross-block wiring,
 * the shared keydown context, the BlockComponent caret methods, the one write to the block's own
 * text, input, composition and clipboard handling. Each block supplies a CursorBackend for its own
 * offsets; state that changes is passed as functions, never as captured values.
 */

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
import type { UserScrollport } from '../../cursor/scroll-ancestors';
import type { ScrollOwner } from '../../cursor/scroll-owner';
import type { BlockElLookup, DocumentGetter, PasteImageHook } from '../../editor-keys';
import { emitClipboardError, type EditorEvents } from '../../editor-events';
import type { InlineMenuCombobox } from '../../inline-menu/inline-menu-state.svelte';
import type { NodeView } from '../../core/node-views';
import { blockAccessibleName } from '../../a11y-strings';
import type { CommandDispatchContext } from '../../schema/block-commands';
import type { PluginActivation } from '../../schema/plugin-activation';
import type { UndoController } from '../../editor-actions/deps';
import type { PasteCommitCoordinator } from '../../tree-operations/paste/paste-deps';
import type { CaretMemory } from '../../cursor/caret-memory';
import type { SelectionState } from '../../selection/selection-state.svelte';
import { placeCaret, selectInBlock } from '../../selection/caret-doors';
import { asEditorX, asRawOffset, type RawOffset } from '../../cursor/coordinate-spaces';
import type { CursorBackend } from '../../cursor/surface-backend';
import { findOffsetNearestX } from '../../cursor/sticky-measure';
import { measurePartialRectsInContentEditable } from '../../cursor/overlay-rects';
import {
	documentLineEnding,
	normalizeLineEndings,
	trailingLineEnding,
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
import { runClipboardCut, takeCopy, type ClipboardArm } from './clipboard-step';
import { createImagePasteArm, type ImagePasteArm } from '../paste-image-arm';
import {
	rawOfWalkOffset,
	revealsNoMarkers,
	selectRawRange,
	walkOffsetOfRaw,
	type RawRange
} from '../../cursor/widget-offset';
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

// ── Accessibility attributes ────────────────────────────────────────────────

/** What an editable block tells assistive tech: its name, and the inline menu's list while
 *  one shows in it. */
export interface EditableSurfaceAttributes {
	role: 'textbox' | 'combobox';
	'aria-label': string;
	'aria-expanded'?: 'true';
	'aria-controls'?: string;
	'aria-activedescendant'?: string;
	'aria-autocomplete'?: 'list';
}

/** The role is `combobox` only while inline menu rows show: `textbox` carries no
 *  `aria-expanded`, so a screen reader would hear nothing about the list. */
export function editableSurfaceAttributes(
	node: NodeView,
	combobox: InlineMenuCombobox | null
): EditableSurfaceAttributes {
	return {
		role: combobox ? 'combobox' : 'textbox',
		'aria-label': blockAccessibleName(node),
		'aria-expanded': combobox ? 'true' : undefined,
		'aria-controls': combobox?.listboxId,
		'aria-activedescendant': combobox?.activeOptionId,
		'aria-autocomplete': combobox ? 'list' : undefined
	};
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
	backend: CursorBackend;
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
	/** Where live mode puts a composed run: an IME's beforeinput is not cancelable, so the byte
	 *  move a keystroke gets at keydown happens at this commit. Null keeps the text as read. */
	relocateComposedText?: (
		after: string,
		composedAt: number
	) => { raw: string; caret: number } | null;
	/** Runs before the shared input commit (the text block resets its snap target here). */
	inputPrelude?: () => void;
	/** The block's own keydown handling, run after the surface records the pre-edit caret. */
	handleKeydown: (e: KeyboardEvent) => Promise<void>;
	/** An undo history the block keeps itself (a shown painted source), asked before the
	 *  editor's; true when it took the event. */
	localHistory?: (e: InputEvent) => boolean;
	/** The block's own beforeinput handling, run after the shared step, which it must not await. */
	handleBeforeInput?: (e: InputEvent) => void;
}

export interface EditableSurface {
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
	/** Wraps the block's `runCommand` (or a clipboard edit), so a command dispatched from
	 *  anywhere, a key or a toolbar, anchors undo on the caret it found. */
	command<A extends unknown[], R>(run: (...args: A) => R): (...args: A) => R;
	/** Bound to the element's `keydown`. */
	onKeyDown: (e: KeyboardEvent) => void;
	/** Bound to the element's `beforeinput`: every input route fires it, keydown or not, so the
	 *  caret the undo entry restores is read here. */
	onBeforeInput: (e: InputEvent) => void;
	onInput: () => void;
	onCompositionStart: () => void;
	onCompositionEnd: () => void;
	/** The caret before the edit in progress: what an edit a block commits itself anchors on. */
	getPreEditOffset(): number;
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
	/** Reads the caret undo puts back after a cut; the cut calls it before hiding a shown source. */
	recordPreEditOffset: () => void;
	/** The caret that record read. */
	getPreEditOffset: () => number;
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
}

export function createEditableSurface(deps: EditableSurfaceDeps): EditableSurface {
	const crossBlock = createCrossBlockHandlers({
		getEl: () => deps.getEl(),
		getMyPath: deps.getMyPath,
		selection: deps.selection,
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

	const focus = placeCaret(deps.selection, parkCaret);

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
		if (el) selectInBlock(deps.selection, () => selectRawRange(el, start, end));
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

	const surface: EditableSurfaceMethods = {
		focus,
		parkCaret,
		focusAtColumn,
		getCursorOffset,
		getSelectedText,
		setSelection,
		measurePartialRects
	};

	// ── Input and composition ─────────────────────────────────────────────────

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

	const writeText = createSurfaceWrite({
		getNode: deps.getNode,
		getIndex: deps.getIndex,
		getPath: deps.getMyPath,
		blockEdit: deps.blockEdit,
		kindCue: deps.kindCue,
		getPreEditOffset: () => preEditOffset,
		requestCaret: deps.requestCaret,
		ownPairs: deps.ownPairs
	});

	function command<A extends unknown[], R>(run: (...args: A) => R): (...args: A) => R {
		return function recorded(...args) {
			recordPreEditOffset();
			return run(...args);
		};
	}

	// A keydown that writes for itself fires no beforeinput, so the caret is read here too.
	const onKeyDown = withKeydownVerdict(async (e) => {
		if (!e.isComposing) recordPreEditOffset();
		await deps.handleKeydown(e);
	});

	// Synchronous to the block's handler: the block's `preventDefault` only counts inside this
	// listener's microtask checkpoint.
	function onBeforeInput(e: InputEvent): void {
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

	/** The DOM `input` handler. Arity zero on purpose: it is bound straight to the event, so a
	 *  parameter here would be the InputEvent. */
	function onInput(): void {
		commitDomRead(false);
	}

	function commitDomRead(fromComposition: boolean): void {
		if (deps.isInputSuppressed?.()) return;
		deps.inputPrelude?.();
		deps.caretMemory.noteTyping();
		const el = deps.getEl();
		if (deps.getComposing() || !el) return;
		const text = deps.readText();
		const savedOffset = deps.backend.getRaw() ?? 0;
		// The same mode check the keydown branches make: a block that draws its delimiters
		// keeps the reading verbatim, since the caret sat beside a byte the user could see.
		const seated =
			fromComposition && revealsNoMarkers(el)
				? (deps.relocateComposedText?.(text, preEditOffset) ?? null)
				: null;
		void writeText({
			text: seated?.raw ?? text,
			caretAfter: seated?.caret ?? savedOffset,
			intent: 'typed',
			mode: 'authored',
			source: fromComposition ? 'composition' : 'input'
		});
	}

	function onCompositionStart(): void {
		if (!deps.getEl()) return;
		traceCompositionStart();
		// Capture before `crossBlock.handleCompositionStart()`, whose delete moves the caret.
		preEditOffset = deps.backend.getRaw() ?? 0;
		crossBlock.handleCompositionStart();
		deps.setComposing(true);
	}

	function onCompositionEnd(): void {
		// `onCompositionStart` always sets the flag, so an unpaired end means a consumer
		// wired compositionend without compositionstart (G1.27).
		assertInvariant('composition-window', () => checkCompositionEndPaired(deps.getComposing()));
		traceCompositionEnd();
		deps.setComposing(false);
		commitDomRead(true);
		crossBlock.handleCompositionEnd();
	}

	const caret: ClipboardCaretIO = {
		getEl: deps.getEl,
		getCursorOffset,
		focus,
		recordPreEditOffset,
		getPreEditOffset: () => preEditOffset
	};

	// The element, not the binding: a torn-down host drops out of the document before Svelte's
	// `bind:this` teardown nulls the reference a resuming handler still holds.
	const isDetached = (): boolean => deps.getEl()?.isConnected !== true;

	return {
		crossBlock,
		sharedCtx,
		surface,
		caret,
		isDetached,
		writeText,
		lineEnding,
		command,
		onKeyDown,
		onBeforeInput,
		onInput,
		onCompositionStart,
		onCompositionEnd,
		getPreEditOffset: () => preEditOffset,
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
	/** The intra-block paste, handed the normalized text and the caret left by hiding a shown
	 *  source. */
	pasteTail: (pastedText: string, foldedCaret: number | null) => void | Promise<void>;
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

	// Reading mode copies what the user sees, which is the browser's selection string with the
	// CSS-hidden markers dropped, not a slice of the raw; so does a copy no `ClipboardArm` takes.
	const writeVisibleSelection = (e: ClipboardEvent): void => {
		e.clipboardData?.setData('text/plain', window.getSelection()?.toString() ?? '');
	};

	function onCopy(e: ClipboardEvent): void {
		deps.caretMemory.forget();
		e.preventDefault();
		if (deps.isReadOnly() || takeCopy(e, arms) === null) writeVisibleSelection(e);
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

	async function onPaste(e: ClipboardEvent): Promise<void> {
		e.preventDefault();
		if (deps.isReadOnly()) return;
		// Read `clipboardData` before the first await, while the event still holds it.
		const images = imageArm.filesOf(e.clipboardData);
		if (images.length === 0) {
			await insertPastedText(normalizeLineEndings(e.clipboardData?.getData('text/plain') ?? ''), e);
			return;
		}
		const fold = deps.foldReveal?.() ?? null;
		await fold?.settled;
		deps.caretMemory.forget();
		await pasteImages(deps, imageArm, e, images, fold?.caret ?? null);
	}

	/** Everything a plain-text paste does, shared by the gesture and the API call; `e` is null
	 *  when there is no gesture to consume. */
	async function insertPastedText(text: string, e: ClipboardEvent | null): Promise<void> {
		const fold = deps.foldReveal?.() ?? null;
		await fold?.settled;
		if (text && deps.pastePreHook && (await deps.pastePreHook(text))) return;
		if (await deps.crossBlock.handlePaste(e, text)) return;
		deps.caretMemory.forget();
		if (!text) return;
		await deps.pasteTail(text, fold?.caret ?? null);
	}

	async function insertMarkdown(md: string): Promise<boolean> {
		if (deps.isReadOnly()) return false;
		const text = normalizeLineEndings(md);
		if (!text) return false;
		await insertPastedText(text, null);
		return true;
	}

	return { onCopy, onCut, onPaste, insertMarkdown };
}

// ── Pasting an image ────────────────────────────────────────────────────────

/** The part of an image paste that needs a caret. The anchor is read before the first await, so
 *  a slow import cannot follow a caret the user moved meanwhile. */
async function pasteImages(
	deps: ClipboardSurfaceDeps,
	imageArm: ImagePasteArm,
	e: ClipboardEvent,
	images: File[],
	foldedCaret: number | null
): Promise<void> {
	const anchor = deps.caret.getCursorOffset() ?? foldedCaret ?? 0;
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
	await deps.pasteTail(text, foldedCaret);
}
