/**
 * Shared editable-surface plumbing for the core contenteditable blocks (TextEditableBlock,
 * CodeBlock, TableCellBlock) and the `editable-leaf` seam: cross-block wiring, the
 * SharedKeydownContext, the BlockComponent surface methods, the input/composition + clipboard
 * skeletons. Each consumer supplies a CursorBackend for its own coordinate system plus the input
 * commit; mutable block state crosses the seam as live thunks, never as snapshots.
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
	PluginEditorLookup,
	LinkReferenceResolverRef,
	PresentationModeGetter
} from '../../editor-keys';
import { emitClipboardError, type EditorEvents } from '../../editor-events';
import type { KeybindingOverrideMap } from '../../schema/keybinding-overrides';
import type { CommandErrorSink, CrossBlockCommandRouter } from '../../schema/block-commands';
import type { GrammarView } from '../../schema/block-openers';
import type { PluginActivation } from '../../schema/plugin-activation';
import type { UndoController } from '../../editor-actions/deps';
import type { PasteCommitCoordinator } from '../../tree-operations/paste/paste-deps';
import type { StickyColumnState } from '../../cursor/sticky-column';
import type { EdgeAffinityState } from '../../cursor/edge-affinity';
import type { SelectionState } from '../../selection/selection-state.svelte';
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
import { traceCompositionStart, traceCompositionEnd } from '../../debug/interaction-trace';
import { assertInvariant } from '../../assert';
import { checkCompositionEndPaired } from '../../invariants/inline-transitions';

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
	/** Ambient marker length in raw units — 0 for code/cell, prose marker width for text. */
	getAmbientLength: () => number;
	backend: CursorBackend;
	/** True while an ephemeral edit (inline-math source reveal) owns the DOM: the block
	 *  commits on exit, so keyboard input and IME compositionend both skip the commit. */
	isInputSuppressed?: () => boolean;

	// ── Live block state (thunks — never snapshot) ────────────────────────────
	getMyPath: () => number[];
	getIndex: () => number;
	getComposing: () => boolean;
	setComposing: (value: boolean) => void;
	getPreEditOffset: () => number;
	setPreEditOffset: (offset: number) => void;
	setPendingCursor: (offset: number | null) => void;

	// ── Cross-block context ───────────────────────────────────────────────────
	selection: SelectionState;
	getDoc: DocumentGetter;
	getBlockElByPath: BlockElLookup;
	focusActions: FocusActions;
	getEditorRoot: () => HTMLElement | null;
	/** What scrolls this editor — the root in self mode, the host's scroller (or the
	 *  window) in host mode; threaded to the cross-block drag-select autoscroll. */
	getScrollHost: () => UserScrollport | null;
	getEditorLifetime: () => AbortSignal | null;
	stickyColumn: StickyColumnState;
	edgeAffinity: EdgeAffinityState;
	blockEdit: BlockEditActions;
	controller: UndoController;
	history: HistoryActions;
	// Per-instance plugin context + command-error sink for the cross-block dispatch tier.
	// Required (undefinable value) so a surface can't skip the thread and silently
	// contain plugin throws.
	pluginEditor: PluginEditorLookup | undefined;
	/** The effective presentation mode, threaded to the cross-block reading gate — a
	 *  sibling to `pluginEditor`, never smuggled through it. */
	getPresentationMode: PresentationModeGetter | undefined;
	/** The instance's link-reference resolver, forwarded to the cross-block join seam. */
	linkRef: LinkReferenceResolverRef | undefined;
	onCommandError: CommandErrorSink | undefined;
	/** The arm a range command routes to; forwarded to the cross-block composer. */
	crossBlockCommands: CrossBlockCommandRouter;
	getKeybindingOverrides: () => KeybindingOverrideMap;
	pasteCoordinator: PasteCommitCoordinator;
	/** The instance's block grammar, forwarded to the cross-block join-paste reparse.
	 *  Required-nullable: a surface must answer, and `undefined` means the global one. */
	grammar: GrammarView | undefined;
	/** The plugins this instance activated, forwarded to the paste-transform pipeline. */
	activePlugins: PluginActivation;
	/** The instance event surface, forwarded to the cross-block tier's clipboard
	 *  error channel — the same `EditorServices.events` the clipboard seam takes. */
	events: EditorEvents;

	// ── SharedKeydownContext per-surface readers ──────────────────────────────
	/** Selection focus endpoint in raw space — surfaces convert or door-mint their DOM read. */
	getFocusOffset: () => RawOffset | null;
	getTextLen: () => number;

	// ── Input skeleton (per-surface) ──────────────────────────────────────────
	/** Read the current DOM content as raw text for the input commit. */
	readText: () => string;
	/** Live mode's typing seat for a COMPOSITION: an IME inserts at the DOM caret and its
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
}

export interface EditableSurface {
	crossBlock: CrossBlockHandlers;
	sharedCtx: SharedKeydownContext;
	surface: EditableSurfaceMethods;
	caret: ClipboardCaretIO;
	/**
	 * True while this surface's element is out of the document — a torn-down host, and equally a
	 * render-primary leaf whose source is folded. Svelte's delegated walk does not await a keydown
	 * handler, so a container above it (a list item's Tab) claims the press and unmounts the block
	 * while a step is suspended; every awaited step asks this before reading on.
	 */
	isDetached(): boolean;
	onInput: () => void;
	onCompositionStart: () => void;
	onCompositionEnd: () => void;
}

/**
 * The caret door the clipboard seam borrows from its surface. `getEl` is a liveness
 * test: a host import hook can outlive the block that started the paste.
 */
export interface ClipboardCaretIO {
	getEl: () => HTMLElement | null;
	getCursorOffset: () => number | null;
	focus: (offset: number) => void;
}

/** The BlockComponent methods shared verbatim across every editable surface. */
export interface EditableSurfaceMethods {
	focus(offset: number): void;
	/** Required here, optional on `BlockComponent`: an editable surface is what the
	 *  cross-block extend paths park into, so every one of them owes the door. */
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
		getPresentationMode: deps.getPresentationMode,
		linkRef: deps.linkRef,
		onCommandError: deps.onCommandError,
		crossBlockCommands: deps.crossBlockCommands,
		getKeybindingOverrides: deps.getKeybindingOverrides,
		pasteCoordinator: deps.pasteCoordinator,
		grammar: deps.grammar,
		activePlugins: deps.activePlugins,
		events: deps.events,
		getCursorOffset: () => deps.backend.getRaw(),
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
		activePlugins: deps.activePlugins
	};

	// ── BlockComponent surface ────────────────────────────────────────────────

	/**
	 * Every caret door lands here, so every offset — sentinel or numeric — clamps into the landable
	 * range: a seat behind a hidden marker run is a position no arrow walk produces, where the next
	 * byte joins a construct the arrival was outside of (live-mode.md § 4.2). Where the markers
	 * paint, the clamp is identity; CURSOR_EXACT_START is the one exception.
	 */
	function parkCaret(offset: number): void {
		const el = deps.getEl();
		if (!el) return;
		el.focus();
		if (offset === CURSOR_EXACT_START) {
			deps.backend.setRaw(asRawOffset(0));
			return;
		}
		const requested = offset === CURSOR_START ? 0 : Math.max(0, offset);
		deps.backend.setRaw(asRawOffset(clampToLandableRaw(el, requested, deps.getAmbientLength())));
	}

	const focus = placeCaret(deps.selection, parkCaret);

	// The vertical door resolves by PIXEL and reaches `setRaw` on its own path, so it does NOT
	// inherit parkCaret's sentinel rule: a column landing already stops on a painted glyph.
	function focusAtColumn(x: number, from: StickyColumnDirection): void {
		const el = deps.getEl();
		if (!el) return;
		el.focus();
		const ambientLength = deps.getAmbientLength();
		// minOffset = the walk position of raw 0 keeps the scan out of the marker region.
		const minOffset = toDomTextOffset(asRawOffset(0), ambientLength);
		const walkOffset = findOffsetNearestX(el, asEditorX(x), from, minOffset);
		deps.backend.setRaw(toClampedRawOffset(walkOffset, ambientLength));
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

	/** The DOM `input` handler. Arity zero on purpose: it is bound straight to the event, so a
	 *  parameter here would be the InputEvent. */
	function onInput(): void {
		commitDomRead(false);
	}

	function commitDomRead(fromComposition: boolean): void {
		if (deps.isInputSuppressed?.()) return;
		deps.inputPrelude?.();
		deps.stickyColumn.reset();
		// The committed bytes belong to the content, whatever arrival seated the caret.
		deps.edgeAffinity.noteTyping();
		const el = deps.getEl();
		if (deps.getComposing() || !el) return;
		const text = deps.readText();
		const savedOffset = deps.backend.getRaw() ?? 0;
		// Same mode gate as the keydown seat's dispatch arms: a surface painting its delimiters
		// keeps the read verbatim — the caret sat beside a byte the user could see.
		const seated =
			fromComposition && revealsNoMarkers(el)
				? (deps.relocateComposedText?.(text, deps.getPreEditOffset()) ?? null)
				: null;
		const caret = seated?.caret ?? savedOffset;
		// preEdit anchors the undo snapshot; caret drives focus when a kind change remounts the
		// block. A commit that rewrites bytes reports the post-rewrite caret.
		const committedCaret = deps.commitInput(seated?.raw ?? text, deps.getPreEditOffset(), caret);
		deps.setPendingCursor(committedCaret ?? caret);
	}

	function onCompositionStart(): void {
		if (!deps.getEl()) return;
		traceCompositionStart();
		// Capture before crossBlock.handleCompositionStart() — sync delete moves the caret.
		deps.setPreEditOffset(deps.backend.getRaw() ?? 0);
		crossBlock.handleCompositionStart();
		deps.setComposing(true);
	}

	function onCompositionEnd(): void {
		// onCompositionStart always arms the flag, so an unpaired end means a consumer
		// wired compositionend without compositionstart (G1.27).
		// TODO(#37): relax to once-per-focus if Safari's duplicate compositionend fires reach here.
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
		onInput,
		onCompositionStart,
		onCompositionEnd
	};
}

// ── Reveal fold ─────────────────────────────────────────────────────────────

/**
 * What folding a live source reveal hands the mutation that triggered it. A fold that
 * changes the block's KIND takes the structural path, whose completion is a promise —
 * so a mutation seam waits on `settled`, not on a tick that happens to outlast it.
 */
export interface RevealFold {
	/** Committed caret offset — where the folded edit left the caret. */
	caret: number;
	/** Resolves once the fold's write has landed and its render has flushed. */
	settled: Promise<void>;
}

// ── Clipboard skeleton ──────────────────────────────────────────────────────

/**
 * The ordered copy / cut / paste skeleton shared by the four editable surfaces, owning the arms
 * that must stay in lockstep (reading gate, cross-block write, reveal fold, image arm) so no
 * surface can skip or resequence one. Paste prevents before its first await, or native paste fires
 * while the fold settles. Reads and writes go through the event's synchronous `clipboardData`;
 * `navigator.clipboard` is permission-gated and unreliable in Tauri's wry webview.
 */
export interface ClipboardSurfaceDeps {
	stickyColumn: StickyColumnState;
	edgeAffinity: EdgeAffinityState;
	selection: SelectionState;
	getDoc: DocumentGetter;
	crossBlock: CrossBlockHandlers;
	/** Reading mode: copy/cut write the visible selection string, paste is inert. */
	isReadOnly: () => boolean;
	/** The surface's caret door, borrowed by the image arm to anchor its insertion. */
	caret: ClipboardCaretIO;
	/** The instance event surface — the image arm's only channel for a host hook that
	 *  rejects. Non-nullable so a surface cannot silently swallow a failed import. */
	events: EditorEvents;
	/** Host image-import hook from the policies context. Undefined leaves an
	 *  image-bearing paste on the text/plain path, exactly as before the hook. */
	onPasteImage: PasteImageHook | undefined;
	/** Fold a live inline-source reveal before a cut/paste mutates, so the mutation runs
	 *  against a CST consistent with the swapped DOM. Omit on a surface with no reveal. */
	foldReveal?: () => RevealFold | null;
	/** Pre-cross-block copy arm (selected-widget slice, intra-table rect). True when it
	 *  wrote the payload and the handler should stop; owns its own preventDefault. */
	copyPreHook?: (e: ClipboardEvent) => boolean;
	/** Pre-cross-block cut arm (selected-widget splice, intra-table rect cut). */
	cutPreHook?: (e: ClipboardEvent) => boolean | Promise<boolean>;
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
	 * Insert `md` exactly as pasting it here would, minus the clipboard — the surface half of
	 * `EditorInstance.insertMarkdown`. True means the pipeline took the text, not that its
	 * commit has flushed; the synchronous declines are reading mode and an empty payload.
	 */
	insertMarkdown(md: string): boolean;
}

export function createClipboardHandlers(deps: ClipboardSurfaceDeps): ClipboardHandlers {
	const crossDeps = { selection: deps.selection, getDoc: deps.getDoc, crossBlock: deps.crossBlock };
	const imageArm = createImagePasteArm({
		onPasteImage: deps.onPasteImage,
		events: deps.events,
		crossBlock: deps.crossBlock
	});

	// Reading mode / plain-text surfaces copy what the reader sees — the native
	// selection string, which drops the CSS-hidden markers — not a raw slice.
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
		// Both reads stay above the fold's settle — see the discipline above.
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
	 * programmatic door carry the fold, the cross-block replace and the surface splice from
	 * one place. `e` is null when there is no gesture to consume.
	 */
	async function insertPastedText(text: string, e: ClipboardEvent | null): Promise<void> {
		const fold = deps.foldReveal?.() ?? null;
		await fold?.settled;
		if (await deps.crossBlock.handlePaste(e, text)) return;
		deps.stickyColumn.reset();
		deps.edgeAffinity.reset();
		if (!text) return;
		await deps.pasteTail(text, fold?.caret ?? null);
	}

	function insertMarkdown(md: string): boolean {
		if (deps.isReadOnly()) return false;
		const text = normalizeLineEndings(md);
		if (!text) return false;
		void insertPastedText(text, null);
		return true;
	}

	return { onCopy, onCut, onPaste, insertMarkdown };
}

// ── Image-paste arm ─────────────────────────────────────────────────────────

/**
 * The surface's half of the image arm — what the shared seam
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
	// Re-seat ONLY when the caret actually drifted: seating collapses the DOM range that
	// every surface tail derives its replaced span from, so seating unconditionally would
	// make this the one paste route that doesn't replace the selection it landed on.
	if (deps.caret.getCursorOffset() !== anchor) deps.caret.focus(anchor);
	await deps.pasteTail(text, foldedCaret);
}
