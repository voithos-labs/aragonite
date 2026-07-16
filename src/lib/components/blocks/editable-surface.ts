/**
 * Shared editable-surface plumbing for the core contenteditable blocks
 * (TextEditableBlock, CodeBlock, table/TableCellBlock) and the `editable-leaf`
 * seam plugin leaves build on. Owns the cross-block handler wiring, the
 * SharedKeydownContext, the BlockComponent surface methods, and the
 * input/composition skeleton. Each consumer constructs a CursorBackend for its
 * own coordinate system (ambient-aware, content-offset, or cell raw walker) and
 * supplies the per-surface input commit; the rest is identical.
 *
 * The component keeps its markup, render `$effect`, the F2 focus-park `$effect`,
 * and its block-specific keydown branches. Mutable block state — `index`,
 * `myPath`, `preEditOffset`, `pendingCursorOffset`, `composing` — crosses the
 * seam as live thunks so undo snapshots and caret restores read current values.
 */

import { tick } from 'svelte';
import type {
	BlockEditActions,
	ContainerEditActions,
	FocusActions,
	HistoryActions
} from '../../action-contracts';
import type { BlockComponent, StickyColumnDirection } from '../../block-component';
import type {
	BlockElLookup,
	DocumentGetter,
	PluginEditorLookup,
	PresentationModeGetter
} from '../../editor-keys';
import type { KeybindingOverrideMap } from '../../schema/keybinding-overrides';
import type { CommandErrorSink } from '../../schema/block-commands';
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
import {
	createCrossBlockHandlers,
	type CrossBlockHandlers
} from '../../selection/cross-block/dispatch';
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
	getEditorLifetime: () => AbortSignal | null;
	stickyColumn: StickyColumnState;
	containerEdit: ContainerEditActions;
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

	// ── SharedKeydownContext per-surface readers ──────────────────────────────
	/** Selection focus endpoint in raw space — surfaces convert or door-mint their DOM read. */
	getFocusOffset: () => RawOffset | null;
	getTextLen: () => number;

	// ── Input skeleton (per-surface) ──────────────────────────────────────────
	/** Read the current DOM content as raw text for the input commit. */
	readText: () => string;
	/** Commit the read text to the CST; owns the trailing-newline and saved-offset shape. */
	commitInput: (text: string, preEditOffset: number, savedOffset: number) => void;
	/** Extra input prelude before the shared body (text resets snap target + keystroke mark). */
	inputPrelude?: () => void;
}

export interface EditableSurface {
	crossBlock: CrossBlockHandlers;
	sharedCtx: SharedKeydownContext;
	surface: EditableSurfaceMethods;
	onInput: () => void;
	onCompositionStart: () => void;
	onCompositionEnd: () => void;
}

/** The BlockComponent methods shared verbatim across the three surfaces. */
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
		getEditorLifetime: deps.getEditorLifetime,
		stickyColumn: deps.stickyColumn,
		containerEdit: deps.containerEdit,
		blockEdit: deps.blockEdit,
		controller: deps.controller,
		history: deps.history,
		pluginEditor: deps.pluginEditor,
		getPresentationMode: deps.getPresentationMode,
		onCommandError: deps.onCommandError,
		getKeybindingOverrides: deps.getKeybindingOverrides,
		pasteCoordinator: deps.pasteCoordinator,
		getCursorOffset: () => deps.backend.getRaw(),
		afterReactivity: () => tick(),
		setPendingCursor: (offset) => deps.setPendingCursor(offset)
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
		// change remounts the block.
		deps.commitInput(text, deps.getPreEditOffset(), savedOffset);
		deps.setPendingCursor(savedOffset);
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

	return { crossBlock, sharedCtx, surface, onInput, onCompositionStart, onCompositionEnd };
}
