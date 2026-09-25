/**
 * Shared editable-surface plumbing for the core contenteditable blocks (TextEditableBlock,
 * CodeBlock, TableCellBlock) and the `editable-leaf` factory: cross-block wiring, the
 * SharedKeydownContext, the BlockComponent surface methods, the input/composition + clipboard
 * skeletons. Each consumer supplies a CursorBackend for its own coordinate system plus the input
 * commit; state that changes is passed as functions, never as captured values.
 */

import { tick } from 'svelte';
import type { BlockEditActions, FocusActions, HistoryActions } from '../../action-contracts';
import {
	CURSOR_EXACT_START,
	CURSOR_START,
	type StickyColumnDirection
} from '../../block-component';
import type { UserScrollport } from '../../cursor/scroll-ancestors';
import type {
	BlockElLookup,
	DocumentGetter,
	PasteImageHook,
	PluginEditorLookup
} from '../../editor-keys';
import { emitClipboardError, type EditorEvents } from '../../editor-events';
import type { InlineMenuCombobox } from '../../inline-menu/inline-menu-state.svelte';
import type { NodeView } from '../../core/node-views';
import { blockAccessibleName } from '../../a11y-strings';
import type { KeybindingOverrideMap } from '../../schema/keybinding-overrides';
import type { CommandErrorSink, CrossBlockCommandRouter } from '../../schema/block-commands';
import type { PluginActivation } from '../../schema/plugin-activation';
import type { UndoController } from '../../editor-actions/deps';
import type { PasteCommitCoordinator } from '../../tree-operations/paste/paste-deps';
import type { StickyColumnState } from '../../cursor/sticky-column';
import type { EdgeAffinityState } from '../../cursor/edge-affinity';
import type { SelectionState } from '../../selection/selection-state.svelte';
import type { SelectedWidgetHandle } from '../../selection/primitives';
import { placeCaret } from '../../selection/caret-doors';
import {
	asEditorX,
	asRawOffset,
	toClampedRawOffset,
	toDomTextOffset,
	type RawOffset
} from '../../cursor/coordinate-spaces';
import { findOffsetNearestX } from '../../cursor/sticky-measure';
import { measurePartialRectsInContentEditable } from '../../cursor/overlay-rects';
import { normalizeLineEndings } from '../../core/lines';
import {
	createCrossBlockHandlers,
	type CrossBlockHandlers
} from '../../selection/cross-block/dispatch';
import { writeCrossBlockCopy, writeCrossBlockCut } from '../../selection/cross-block/clipboard';
import { createImagePasteArm, type ImagePasteArm } from '../paste-image-arm';
import { clampToLandableRaw, revealsNoMarkers } from '../../cursor/widget-offset';
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

/**
 * Binds a block's keydown handler so the interaction trace records one decision per event,
 * after the handler's own await chain settles. That record is the e2e harness's only positive
 * signal that a gesture which must change nothing has finished. Disabled, one boolean read.
 */
export function withKeydownVerdict(
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

/**
 * The role and name every editable block renders, from one place. The role is `combobox` only
 * while inline menu rows show, because `textbox` carries no `aria-expanded` and a screen reader
 * would then hear nothing about the list; `list` is what a combobox of suggestions says it does.
 */
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

/**
 * Per-surface cursor I/O in raw-content coordinates (ambient marker excluded).
 * `buildRange` maps a raw-offset span to a DOM Range for selection writes.
 */
export interface CursorBackend {
	getRaw(): RawOffset | null;
	setRaw(offset: RawOffset): void;
	buildRange(start: RawOffset, end: RawOffset): Range | null;
}

/**
 * Guarded pending-caret restore. Applies only while `el` still holds focus, so a blur
 * between arming the restore and the render drops it instead of yanking the global
 * selection back. Callers clear their pending field unconditionally regardless.
 */
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
	/** Marker prefix length in raw units: 0 for a code block or cell, the marker's width for text. */
	getAmbientLength: () => number;
	backend: CursorBackend;
	/** True while an ephemeral edit (inline-math source reveal) owns the DOM: the block
	 *  commits on exit, so keyboard input and IME compositionend both skip the commit. */
	isInputSuppressed?: () => boolean;

	// ── Live block state (functions, never captured values) ───────────────────
	getMyPath: () => number[];
	getIndex: () => number;
	getComposing: () => boolean;
	setComposing: (value: boolean) => void;
	setPendingCursor: (offset: number | null) => void;

	// ── Cross-block context ───────────────────────────────────────────────────
	selection: SelectionState;
	getDoc: DocumentGetter;
	getBlockElByPath: BlockElLookup;
	focusActions: FocusActions;
	getEditorRoot: () => HTMLElement | null;
	/** What scrolls this editor (the root in self mode; the host's scroller or the window in
	 *  host mode), for the cross-block drag-select autoscroll. */
	getScrollHost: () => UserScrollport | null;
	getEditorLifetime: () => AbortSignal | null;
	stickyColumn: StickyColumnState;
	edgeAffinity: EdgeAffinityState;
	blockEdit: BlockEditActions;
	controller: UndoController;
	history: HistoryActions;
	// This editor's plugin context and its command-error callback, for cross-block dispatch.
	// Required (undefinable value) so a surface can't skip the thread and silently
	// contain plugin throws.
	pluginEditor: PluginEditorLookup | undefined;
	/** How this editor reads its bytes, for the cross-block join rules, the join-paste reparse and
	 *  the reading-mode check. */
	reading: Reading;
	onCommandError: CommandErrorSink | undefined;
	/** The handler a range command goes to, passed to the cross-block composer. */
	crossBlockCommands: CrossBlockCommandRouter;
	getKeybindingOverrides: () => KeybindingOverrideMap;
	pasteCoordinator: PasteCommitCoordinator;
	/** The plugins this instance activated, forwarded to the paste-transform pipeline. */
	activePlugins: PluginActivation;
	/** This editor's events, passed to the cross-block clipboard's error reporting: the
	 *  same `EditorServices.events` the shared clipboard code takes. */
	events: EditorEvents;
	/** The image selected whole, passed to the shift-press that grows a range from it. */
	selectedWidget: SelectedWidgetHandle;

	// ── The per-block reads `SharedKeydownContext` needs ──────────────────────
	/** The selection's focus endpoint as a raw offset; each block converts its own DOM read. */
	getFocusOffset: () => RawOffset | null;
	getTextLen: () => number;

	// ── Input skeleton (per-surface) ──────────────────────────────────────────
	/** Read the current DOM content as raw text for the input commit. */
	readText: () => string;
	/** Where live mode puts a composed run: an IME inserts at the DOM caret and its
	 *  beforeinput is not cancelable, so the byte relocation a keystroke takes at keydown is
	 *  taken on this commit instead. Null keeps the read verbatim. */
	relocateComposedText?: (
		after: string,
		composedAt: number
	) => { raw: string; caret: number } | null;
	/**
	 * Commit the read text to the CST. Returns the caret offset to restore when the
	 * committed bytes differ from the DOM (a cell escaping a typed `|` to `\|`); void
	 * keeps the DOM caret.
	 */
	commitInput: (text: string, preEditOffset: number, savedOffset: number) => number | void;
	/** Extra input prelude before the shared body (text resets snap target + keystroke mark). */
	inputPrelude?: () => void;
	/** The block's own beforeinput handling, run after the surface records the pre-edit caret. */
	handleBeforeInput?: (e: InputEvent) => unknown;
}

export interface EditableSurface {
	crossBlock: CrossBlockHandlers;
	sharedCtx: SharedKeydownContext;
	surface: EditableSurfaceMethods;
	caret: ClipboardCaretIO;
	/**
	 * True while this block's element is out of the document (a torn-down host, a folded leaf).
	 * Svelte does not await a keydown handler, so a container above can unmount the block while a
	 * step is suspended; every awaited step asks this before reading on.
	 */
	isDetached(): boolean;
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
}

/** A span of a block's raw text. */
export interface RawRange {
	start: number;
	end: number;
}

/** The BlockComponent methods shared verbatim across every editable surface. */
export interface EditableSurfaceMethods {
	focus(offset: number): void;
	/** Required here, optional on `BlockComponent`: an editable surface is what the
	 *  cross-block extend paths leave a caret in, so all of them go through here. */
	parkCaret(offset: number): void;
	/** `within` is the raw range the landing must stay inside, for a block whose first or last
	 *  visual line takes no caret (a code fence); the default is the whole block. */
	focusAtColumn(x: number, from: StickyColumnDirection, within?: RawRange): void;
	getCursorOffset(): number | null;
	getSelectedText(): string;
	setSelection(start: number, end: number): void;
	measurePartialRects(startOffset: number, endOffset: number): DOMRect[];
}

export function createEditableSurface(deps: EditableSurfaceDeps): EditableSurface {
	const crossBlock = createCrossBlockHandlers({
		getEl: () => deps.getEl(),
		getMyPath: deps.getMyPath,
		getIndex: deps.getIndex,
		selection: deps.selection,
		getDoc: deps.getDoc,
		getBlockElByPath: deps.getBlockElByPath,
		revealPath: deps.focusActions.revealPath,
		getEditorRoot: deps.getEditorRoot,
		getScrollHost: deps.getScrollHost,
		getEditorLifetime: deps.getEditorLifetime,
		stickyColumn: deps.stickyColumn,
		edgeAffinity: deps.edgeAffinity,
		blockEdit: deps.blockEdit,
		controller: deps.controller,
		history: deps.history,
		pluginEditor: deps.pluginEditor,
		reading: deps.reading,
		onCommandError: deps.onCommandError,
		crossBlockCommands: deps.crossBlockCommands,
		getKeybindingOverrides: deps.getKeybindingOverrides,
		pasteCoordinator: deps.pasteCoordinator,
		activePlugins: deps.activePlugins,
		events: deps.events,
		getCursorOffset: () => deps.backend.getRaw(),
		selectedWidget: deps.selectedWidget,
		afterReactivity: () => tick()
	});

	const sharedCtx: SharedKeydownContext = {
		getEl: () => deps.getEl(),
		getCursorOffset: () => deps.backend.getRaw(),
		getFocusOffset: deps.getFocusOffset,
		getTextLen: deps.getTextLen,
		getAmbientLength: deps.getAmbientLength,
		getMyPath: deps.getMyPath,
		getIndex: deps.getIndex,
		crossBlock,
		selection: deps.selection,
		stickyColumn: deps.stickyColumn,
		edgeAffinity: deps.edgeAffinity,
		history: deps.history,
		focus: deps.focusActions,
		getDoc: deps.getDoc,
		getBlockElByPath: deps.getBlockElByPath,
		activePlugins: deps.activePlugins,
		reading: deps.reading
	};

	// ── BlockComponent surface ────────────────────────────────────────────────

	/**
	 * Every caret placement lands here, so every offset clamps to where a caret can sit: behind a
	 * hidden marker run the next byte would join a construct the caret arrived outside of
	 * (live-mode.md § 4.2). Where markers paint the clamp changes nothing; CURSOR_EXACT_START
	 * skips it.
	 */
	function parkCaret(offset: number): void {
		const el = deps.getEl();
		if (!el) return;
		// Placing a caret never scrolls; the caller that brings an off-screen target into view
		// does that itself.
		el.focus({ preventScroll: true });
		if (offset === CURSOR_EXACT_START) {
			deps.backend.setRaw(asRawOffset(0));
			return;
		}
		const requested = offset === CURSOR_START ? 0 : Math.max(0, offset);
		deps.backend.setRaw(asRawOffset(clampToLandableRaw(el, requested, deps.getAmbientLength())));
	}

	const focus = placeCaret(deps.selection, parkCaret);

	// The vertical move resolves by pixel and reaches `setRaw` on its own path, so it does not
	// inherit parkCaret's sentinel rule: a column landing already stops on a painted glyph.
	function focusAtColumn(x: number, from: StickyColumnDirection, within?: RawRange): void {
		const el = deps.getEl();
		if (!el) return;
		el.focus({ preventScroll: true });
		const ambientLength = deps.getAmbientLength();
		// `within` is in raw offsets, so the default floor of raw 0 keeps the scan out of the
		// container's marker prefix.
		const min = toDomTextOffset(asRawOffset(within?.start ?? 0), ambientLength);
		const max = within ? toDomTextOffset(asRawOffset(within.end), ambientLength) : undefined;
		const walkOffset = findOffsetNearestX(el, asEditorX(x), from, min, max);
		deps.backend.setRaw(toClampedRawOffset(walkOffset, ambientLength));
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
		if (!deps.getEl()) return;
		const range = deps.backend.buildRange(asRawOffset(start), asRawOffset(end));
		if (!range) return;
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	function measurePartialRects(startOffset: number, endOffset: number): DOMRect[] {
		const el = deps.getEl();
		if (!el) return [];
		const ambientLength = deps.getAmbientLength();
		return measurePartialRectsInContentEditable(
			el,
			toDomTextOffset(asRawOffset(startOffset), ambientLength),
			toDomTextOffset(asRawOffset(endOffset), ambientLength)
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

	// ── Input / composition skeleton ──────────────────────────────────────────

	// The caret before the edit, so undo puts it back there. A composition keeps the one read at
	// its start: Chromium fires the composition's own beforeinput events after that.
	let preEditOffset = 0;

	function onBeforeInput(e: InputEvent): void {
		if (!deps.getComposing() && !e.isComposing) preEditOffset = deps.backend.getRaw() ?? 0;
		void deps.handleBeforeInput?.(e);
	}

	/** The DOM `input` handler. Arity zero on purpose: it is bound straight to the event, so a
	 *  parameter here would be the InputEvent. */
	function onInput(): void {
		commitDomRead(false);
	}

	function commitDomRead(fromComposition: boolean): void {
		if (deps.isInputSuppressed?.()) return;
		deps.inputPrelude?.();
		deps.stickyColumn.reset();
		// The committed bytes belong to the content, however the caret got there.
		deps.edgeAffinity.noteTyping();
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
		const caret = seated?.caret ?? savedOffset;
		// preEdit anchors the undo snapshot; caret drives focus when a kind change remounts the
		// block. A commit that rewrites bytes reports the post-rewrite caret.
		const committedCaret = deps.commitInput(seated?.raw ?? text, preEditOffset, caret);
		deps.setPendingCursor(committedCaret ?? caret);
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
	}

	const caret: ClipboardCaretIO = { getEl: deps.getEl, getCursorOffset, focus };

	// The element, not the binding: a torn-down host drops out of the document before Svelte's
	// `bind:this` teardown nulls the reference a resuming handler still holds.
	const isDetached = (): boolean => deps.getEl()?.isConnected !== true;

	return {
		crossBlock,
		sharedCtx,
		surface,
		caret,
		isDetached,
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

// ── Reveal fold ─────────────────────────────────────────────────────────────

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

// ── Clipboard skeleton ──────────────────────────────────────────────────────

/**
 * The copy, cut and paste steps shared by the four editable blocks, in one order no block can
 * skip or reshuffle. Paste prevents the default before its first await, or the native paste runs
 * while a shown source hides. Everything goes through the event's synchronous `clipboardData`;
 * `navigator.clipboard` is permission-gated and unreliable in Tauri's webview.
 */
export interface ClipboardSurfaceDeps {
	stickyColumn: StickyColumnState;
	edgeAffinity: EdgeAffinityState;
	selection: SelectionState;
	getDoc: DocumentGetter;
	crossBlock: CrossBlockHandlers;
	/** Reading mode: copy/cut write the visible selection string, paste is inert. */
	isReadOnly: () => boolean;
	/** The block's caret calls, borrowed by the image branch to anchor its insertion. */
	caret: ClipboardCaretIO;
	/** This editor's events: the image branch's only way to report a host hook that
	 *  rejects. Non-nullable so a surface cannot silently swallow a failed import. */
	events: EditorEvents;
	/** Host image-import hook from the policies context. Undefined leaves an
	 *  image-bearing paste on the text/plain path, exactly as before the hook. */
	onPasteImage: PasteImageHook | undefined;
	/** Fold a live inline-source reveal before a cut/paste mutates, so the mutation runs
	 *  against a CST consistent with the swapped DOM. Omit on a surface with no reveal. */
	foldReveal?: () => RevealFold | null;
	/** The copy step before cross-block handling (a selected widget, a table rectangle). True when it
	 *  wrote the payload and the handler should stop; owns its own preventDefault. */
	copyPreHook?: (e: ClipboardEvent) => boolean;
	/** The cut step before cross-block handling (a selected widget, a table rectangle). */
	cutPreHook?: (e: ClipboardEvent) => boolean | Promise<boolean>;
	/** The paste step before cross-block handling, given the normalised text while a rectangle is
	 *  readable (a grid into a table's cells). True when it consumed the paste. */
	pastePreHook?: (text: string) => boolean | Promise<boolean>;
	/** The intra-block copy payload; owns its preventDefault. Omit to write the
	 *  visible selection string (code, leaf); text and the cell slice their raw. */
	copyTail?: (e: ClipboardEvent) => void;
	/** The intra-block cut: a synchronous clipboardData write, then the CST delete. */
	cutTail: (e: ClipboardEvent) => void | Promise<void>;
	/** The intra-block paste after normalize: the surface's splice/dispatch, handed
	 *  the normalized text and the reveal-fold landing caret. */
	pasteTail: (pastedText: string, foldedCaret: number | null) => void | Promise<void>;
}

export interface ClipboardHandlers {
	onCopy(e: ClipboardEvent): void;
	onCut(e: ClipboardEvent): Promise<void>;
	onPaste(e: ClipboardEvent): Promise<void>;
	/**
	 * Insert `md` exactly as pasting it here would, without the clipboard: the block's half of
	 * `EditorInstance.insertMarkdown`. Resolves once the paste has landed; false for reading
	 * mode and an empty payload, which write nothing.
	 */
	insertMarkdown(md: string): Promise<boolean>;
}

export function createClipboardHandlers(deps: ClipboardSurfaceDeps): ClipboardHandlers {
	const crossDeps = { selection: deps.selection, getDoc: deps.getDoc, crossBlock: deps.crossBlock };
	const imageArm = createImagePasteArm({
		onPasteImage: deps.onPasteImage,
		events: deps.events,
		crossBlock: deps.crossBlock
	});

	// Reading mode and plain-text blocks copy what the user sees, which is the browser's
	// selection string with the CSS-hidden markers dropped, not a slice of the raw.
	const writeVisibleSelection = (e: ClipboardEvent): void => {
		e.clipboardData?.setData('text/plain', window.getSelection()?.toString() ?? '');
	};

	function onCopy(e: ClipboardEvent): void {
		deps.stickyColumn.reset();
		deps.edgeAffinity.reset();
		if (deps.isReadOnly()) {
			e.preventDefault();
			writeVisibleSelection(e);
			return;
		}
		if (deps.copyPreHook?.(e)) return;
		if (writeCrossBlockCopy(e, crossDeps)) return;
		if (deps.copyTail) {
			deps.copyTail(e);
			return;
		}
		e.preventDefault();
		writeVisibleSelection(e);
	}

	async function onCut(e: ClipboardEvent): Promise<void> {
		deps.stickyColumn.reset();
		deps.edgeAffinity.reset();
		e.preventDefault();
		if (deps.isReadOnly()) {
			onCopy(e);
			return;
		}
		await deps.foldReveal?.()?.settled;
		if (await deps.cutPreHook?.(e)) return;
		if (await writeCrossBlockCut(e, crossDeps)) return;
		await deps.cutTail(e);
	}

	async function onPaste(e: ClipboardEvent): Promise<void> {
		e.preventDefault();
		if (deps.isReadOnly()) return;
		// Both reads happen before the write settles; see the rule above.
		const images = imageArm.filesOf(e.clipboardData);
		if (images.length === 0) {
			await insertPastedText(normalizeLineEndings(e.clipboardData?.getData('text/plain') ?? ''), e);
			return;
		}
		const fold = deps.foldReveal?.() ?? null;
		await fold?.settled;
		deps.stickyColumn.reset();
		deps.edgeAffinity.reset();
		await pasteImages(deps, imageArm, e, images, fold?.caret ?? null);
	}

	/**
	 * Everything a paste does once its payload is plain text, so the gesture and the
	 * API call hide a shown source, do the cross-block replace and splice the block from
	 * one place. `e` is null when there is no gesture to consume.
	 */
	async function insertPastedText(text: string, e: ClipboardEvent | null): Promise<void> {
		const fold = deps.foldReveal?.() ?? null;
		await fold?.settled;
		if (text && deps.pastePreHook && (await deps.pastePreHook(text))) return;
		if (await deps.crossBlock.handlePaste(e, text)) return;
		deps.stickyColumn.reset();
		deps.edgeAffinity.reset();
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

/**
 * The block's half of the image paste: what the shared code
 * (`components/paste-image-arm.ts`) cannot do, because it needs a caret. The anchor is
 * captured before the first await, so a slow import cannot follow a caret the user
 * moved meanwhile.
 */
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
	// surface tails would fall back to offset 0. Decline, loudly.
	if (!deps.caret.getEl()) {
		emitClipboardError(deps.events, {
			error: new Error('onPasteImage resolved after its block was gone; insertion declined')
		});
		return;
	}
	// Move the caret only when it actually drifted: placing one collapses the DOM range every
	// block reads its replaced span from, so placing it unconditionally would
	// make this the one paste route that doesn't replace the selection it landed on.
	if (deps.caret.getCursorOffset() !== anchor) deps.caret.focus(anchor);
	await deps.pasteTail(text, foldedCaret);
}
