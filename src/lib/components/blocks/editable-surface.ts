/**
 * Shared editable-surface plumbing for the core contenteditable blocks
 * (TextEditableBlock, CodeBlock, table/TableCellBlock) and the `editable-leaf`
 * seam plugin leaves build on. Owns the cross-block handler wiring, the
 * SharedKeydownContext, the BlockComponent surface methods, the input/composition
 * skeleton, and — below the divider — the copy/cut/paste skeleton and its host
 * image-import arm. Each consumer constructs a CursorBackend for its own
 * coordinate system (ambient-aware, content-offset, or cell raw walker) and
 * supplies the per-surface input commit; the rest is identical.
 *
 * The component keeps its markup, render `$effect`, the F2 focus-park `$effect`,
 * and its block-specific keydown branches. Mutable block state — `index`,
 * `myPath`, `preEditOffset`, `pendingCursorOffset`, `composing` — crosses the
 * seam as live thunks so undo snapshots and caret restores read current values.
 */

import { tick } from 'svelte';
import type { BlockEditActions, FocusActions, HistoryActions } from '../../action-contracts';
import type { StickyColumnDirection } from '../../block-component';
import type {
	BlockElLookup,
	DocumentGetter,
	PasteImageHook,
	PluginEditorLookup,
	PresentationModeGetter
} from '../../editor-keys';
import type { EditorEvents } from '../../editor-events';
import type { KeybindingOverrideMap } from '../../schema/keybinding-overrides';
import type { CommandErrorSink } from '../../schema/block-commands';
import type { GrammarView } from '../../schema/block-openers';
import type { UndoController } from '../../editor-actions/deps';
import type { PasteCommitCoordinator } from '../../tree-operations/paste/paste-deps';
import type { StickyColumnState } from '../../cursor/sticky-column';
import type { SelectionState } from '../../selection/selection-state.svelte';
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
import type { SharedKeydownContext } from '../../selection/shared-keydown';
import { traceCompositionStart, traceCompositionEnd } from '../../debug/interaction-trace';
import { assertInvariant } from '../../invariants/assert';
import { checkCompositionEndPaired } from '../../invariants/inline-transitions';

/**
 * Per-surface cursor I/O in raw-content coordinates (ambient marker excluded).
 * Text/cell wrap an AmbientCursorIO; code adapts the content-offset helpers.
 * `buildRange` maps a raw-offset span to a DOM Range for selection writes.
 */
export interface CursorBackend {
	getRaw(): RawOffset | null;
	setRaw(offset: RawOffset): void;
	buildRange(start: RawOffset, end: RawOffset): Range | null;
}

/**
 * Guarded pending-caret restore, shared by the three surfaces' render/sync passes.
 * Applies only while `el` still holds focus, so a blur between arming the restore
 * and the render drops it instead of yanking the global selection back into the
 * just-blurred block. Returns whether it applied; callers own the pending field and
 * clear it unconditionally afterward, so a skipped restore is never re-armed.
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
	/** True while an ephemeral edit (inline-math source reveal) owns the DOM: the
	 *  block commits on exit, not per-keystroke, so both keyboard input and IME
	 *  compositionend must skip the CST commit here — the one choke point both
	 *  paths funnel through (compositionend calls this same internal onInput). */
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
	/** What scrolls this editor — the root in self mode, the host's scroller in host
	 *  mode; threaded to the cross-block drag-select autoscroll. */
	getScrollHost: () => HTMLElement | null;
	getEditorLifetime: () => AbortSignal | null;
	stickyColumn: StickyColumnState;
	blockEdit: BlockEditActions;
	controller: UndoController;
	history: HistoryActions;
	// Per-instance plugin context + command-error sink, threaded into the cross-block
	// dispatch tier. Required fields (undefinable value) so a surface can't skip the
	// thread — the cross-block path would otherwise contain plugin throws silently.
	pluginEditor: PluginEditorLookup | undefined;
	/** The effective presentation mode, threaded to the cross-block reading gate — a
	 *  sibling to `pluginEditor`, never smuggled through it. */
	getPresentationMode: PresentationModeGetter | undefined;
	onCommandError: CommandErrorSink | undefined;
	getKeybindingOverrides: () => KeybindingOverrideMap;
	pasteCoordinator: PasteCommitCoordinator;
	/** The instance's block grammar (`registryView.grammar`), forwarded to the
	 *  cross-block join-paste reparse. Required-nullable to match the dispatch tier it
	 *  feeds: a surface must answer the question, and `undefined` means the global
	 *  grammar deliberately. */
	grammar: GrammarView | undefined;
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
	/**
	 * Commit the read text to the CST; owns the trailing-newline and saved-offset
	 * shape. Returns the caret offset to restore when the committed bytes differ
	 * from the DOM (a cell escaping a typed `|` to `\|`); void keeps the DOM caret.
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
	onInput: () => void;
	onCompositionStart: () => void;
	onCompositionEnd: () => void;
}

/**
 * The caret door the clipboard seam borrows from its surface. `getEl` is here as a
 * liveness test, because a host import hook can outlive the block that started the
 * paste. Minted by `createEditableSurface` so each surface threads one value.
 */
export interface ClipboardCaretIO {
	getEl: () => HTMLElement | null;
	getCursorOffset: () => number | null;
	focus: (offset: number) => void;
}

/** The BlockComponent methods shared verbatim across every editable surface. */
export interface EditableSurfaceMethods {
	focus(offset: number): void;
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
		blockEdit: deps.blockEdit,
		controller: deps.controller,
		history: deps.history,
		pluginEditor: deps.pluginEditor,
		getPresentationMode: deps.getPresentationMode,
		onCommandError: deps.onCommandError,
		getKeybindingOverrides: deps.getKeybindingOverrides,
		pasteCoordinator: deps.pasteCoordinator,
		grammar: deps.grammar,
		events: deps.events,
		getCursorOffset: () => deps.backend.getRaw(),
		afterReactivity: () => tick()
	});

	const sharedCtx: SharedKeydownContext = {
		getEl: () => deps.getEl(),
		getCursorOffset: () => deps.backend.getRaw(),
		getFocusOffset: deps.getFocusOffset,
		getTextLen: deps.getTextLen,
		getMyPath: deps.getMyPath,
		getIndex: deps.getIndex,
		crossBlock,
		selection: deps.selection,
		stickyColumn: deps.stickyColumn,
		history: deps.history,
		focus: deps.focusActions,
		getDoc: deps.getDoc,
		getBlockElByPath: deps.getBlockElByPath
	};

	// ── BlockComponent surface ────────────────────────────────────────────────

	function focus(offset: number): void {
		const el = deps.getEl();
		if (!el) return;
		el.focus();
		deps.backend.setRaw(asRawOffset(Math.max(0, offset)));
	}

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
		focusAtColumn,
		getCursorOffset,
		getSelectedText,
		setSelection,
		measurePartialRects
	};

	// ── Input / composition skeleton ──────────────────────────────────────────

	function onInput(): void {
		if (deps.isInputSuppressed?.()) return;
		deps.inputPrelude?.();
		deps.stickyColumn.reset();
		if (deps.getComposing() || !deps.getEl()) return;
		const text = deps.readText();
		const savedOffset = deps.backend.getRaw() ?? 0;
		// preEdit anchors the undo snapshot; savedOffset drives focus when a kind
		// change remounts the block. A commit that rewrites the bytes (cell pipe
		// escape) reports the post-rewrite caret so the re-render seats it correctly.
		const committedCaret = deps.commitInput(text, deps.getPreEditOffset(), savedOffset);
		deps.setPendingCursor(committedCaret ?? savedOffset);
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
		// Browsers pair composition events per element and onCompositionStart always
		// arms the flag, so an unpaired end means a consumer wired compositionend
		// without compositionstart — both are exposed for plugin markup (G1.27).
		// Caveat: Safari has shipped duplicate compositionend fires; if that
		// false-fires in the field, relax to once-per-focus (issues.md § G1.27).
		assertInvariant('composition-window', () => checkCompositionEndPaired(deps.getComposing()));
		traceCompositionEnd();
		deps.setComposing(false);
		onInput();
	}

	const caret: ClipboardCaretIO = { getEl: deps.getEl, getCursorOffset, focus };

	return { crossBlock, sharedCtx, surface, caret, onInput, onCompositionStart, onCompositionEnd };
}

// ── Clipboard skeleton ──────────────────────────────────────────────────────

/**
 * The ordered copy / cut / paste skeleton shared by the four editable surfaces
 * (text, code, table cell, and the `editable-leaf` plugin seam). It owns the arms
 * that must stay in lockstep — the reading-mode gate, the cross-block copy/cut
 * write, the reveal fold, the host image-import arm, and the paste's
 * preventDefault-before-any-await — so a new surface can neither skip a step nor
 * resequence one. Each surface supplies only its genuinely-different arms: the
 * intra-block payload tails, and the optional pre-cross-block arms (a
 * selected-widget copy, an intra-table rect).
 *
 * The preventDefault discipline, stated once here so no call site re-derives it:
 *  - Paste prevents before the first await, or the browser's native paste fires
 *    during the reveal-fold tick (or the cross-block await) and injects DOM the
 *    CST never sees.
 *  - Cut prevents up front — every cut arm writes.
 *  - Copy prevents as it writes: a cell with no selection writes nothing and lets
 *    native copy through, so the copy arms (not the seam) own their prevent.
 * Every READ and write goes through the event's synchronous `clipboardData` —
 * `navigator.clipboard.writeText` is async/permission-gated and unreliable in
 * Tauri's wry webview, and the event's own accessor is not dependably live once
 * the handler has awaited.
 */
export interface ClipboardSurfaceDeps {
	stickyColumn: StickyColumnState;
	selection: SelectionState;
	getDoc: DocumentGetter;
	crossBlock: CrossBlockHandlers;
	/** Reading mode: copy/cut write the visible selection string, paste is inert. */
	isReadOnly: () => boolean;
	/** The surface's caret door, borrowed by the image arm to anchor its insertion. */
	caret: ClipboardCaretIO;
	/** The instance event surface — the image arm's only channel for a host hook
	 *  that rejects. Non-nullable so a surface cannot silently swallow every failed
	 *  import; every surface sources it from `EditorServices.events`, which is itself
	 *  non-optional, so there is nothing to widen for. */
	events: EditorEvents;
	/** Host image-import hook from the policies context. Undefined leaves an
	 *  image-bearing paste on the text/plain path, exactly as before the hook. */
	onPasteImage: PasteImageHook | undefined;
	/** Fold a live inline-source reveal before a cut/paste mutates, so the mutation
	 *  runs against a CST consistent with the swapped DOM; returns the committed
	 *  caret, or null when nothing was revealed. Omit on a surface with no reveal. */
	foldReveal?: () => number | null;
	/** Pre-cross-block copy arm (selected-widget slice, intra-table rect). Returns
	 *  true when it wrote the payload and the handler should stop; owns its own
	 *  preventDefault. */
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
	pasteTail: (
		e: ClipboardEvent,
		pastedText: string,
		foldedCaret: number | null
	) => void | Promise<void>;
}

export interface ClipboardHandlers {
	onCopy(e: ClipboardEvent): void;
	onCut(e: ClipboardEvent): Promise<void>;
	onPaste(e: ClipboardEvent): Promise<void>;
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
		e.preventDefault();
		if (deps.isReadOnly()) {
			onCopy(e);
			return;
		}
		if (deps.foldReveal && deps.foldReveal() !== null) await tick();
		if (await deps.cutPreHook?.(e)) return;
		if (await writeCrossBlockCut(e, crossDeps)) return;
		await deps.cutTail(e);
	}

	async function onPaste(e: ClipboardEvent): Promise<void> {
		e.preventDefault();
		if (deps.isReadOnly()) return;
		// Both reads stay above the fold's tick — see the discipline above.
		const images = imageArm.filesOf(e.clipboardData);
		const foldedCaret = deps.foldReveal?.() ?? null;
		if (foldedCaret !== null) await tick();
		if (images.length > 0) {
			deps.stickyColumn.reset();
			await pasteImages(deps, imageArm, e, images, foldedCaret);
			return;
		}
		if (await deps.crossBlock.handlePaste(e)) return;
		deps.stickyColumn.reset();
		const pastedText = normalizeLineEndings(e.clipboardData?.getData('text/plain') ?? '');
		if (!pastedText) return;
		await deps.pasteTail(e, pastedText, foldedCaret);
	}

	return { onCopy, onCut, onPaste };
}

// ── Image-paste arm ─────────────────────────────────────────────────────────

/**
 * The surface's half of the image arm: everything the shared seam
 * (`components/paste-image-arm.ts`) cannot do, because it depends on having a
 * caret. The anchor is captured before the first await, so an import that takes
 * seconds cannot follow a caret the user moved meanwhile — the deliberate
 * asymmetry with the shared seam's cross-block branch, which reads `isCrossBlock`
 * live because the route it delegates to resolves endpoints by path at call time.
 * Both are documented in the requirement file; snapshotting the mode at paste time
 * would fight the by-path seam, which is what makes the landing independent of
 * which surface caught the event.
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
	// surface tails would fall back to offset 0 — markdown at a position the user
	// never pointed at. Decline, loudly.
	if (!deps.caret.getEl()) {
		deps.events.emit('error', {
			origin: 'command',
			error: new Error('onPasteImage resolved after its block was gone; insertion declined')
		});
		return;
	}
	// Re-seat ONLY when the caret actually drifted. Seating collapses the DOM range,
	// and every surface tail derives its replaced span from that range — so seating
	// unconditionally would make this the one paste route that doesn't replace the
	// selection it landed on.
	if (deps.caret.getCursorOffset() !== anchor) deps.caret.focus(anchor);
	await deps.pasteTail(e, text, foldedCaret);
}
