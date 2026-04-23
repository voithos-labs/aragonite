/**
 * Cross-block event dispatch shared by TextEditableBlock and CodeBlock.
 * Factory returns handler functions each block component calls at the top
 * of its own event handlers; single-block handling stays in each component.
 */

import type { SelectionState } from './selection-state.svelte';
import type { SelectionPoint } from './primitives';
import type {
	BlockElLookup,
	BlockEditActions,
	ContainerEditActions,
	DocumentGetter
} from '../contracts';
import type { CstNode, Document } from '../core/nodes';
import type { StickyColumnState } from '../contenteditable/sticky-column';
import type { CrossBlockMutationContext } from './cross-block-ops';
import type { UndoController } from '../components/editor-actions/deps';
import { collectCrossBlockText } from './clipboard-text';
import { normalizeLineEndings } from '../core/lines';
import { performCrossBlockDelete, performCrossBlockDeleteSync } from './cross-block-ops';
import {
	collapseCrossBlock,
	extendFocusToNextBlock,
	extendFocusToPreviousBlock,
	extendFocusToDocEdge,
	selectWholeDocument,
	handleShiftClick,
	scrollFocusBlockIntoView
} from './keyboard-extend';
import { findBlockPathForElement } from './path-lookup';
import { nodeAt } from '../tree-operations/node-ops';
import {
	applyCollapsedCaret,
	clearNativeSelection,
	offsetFromViewportPoint
} from './native-bridge';
import { installDragListener } from './drag-pointer';
import { ambientSpanOf, placeCaretAfterAmbientSpan } from '../contenteditable/ambient-dom';
import { createRangeFromOffsets } from '../contenteditable/cursor-utils';
import { rebuildContainerRawIfContainer } from '../tree-operations/container-raw';
import { pasteDispatch } from '../tree-operations/paste-dispatch';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockDispatchContext {
	getEl: () => HTMLElement | null;
	getMyPath: () => number[];
	getIndex: () => number;

	selection: SelectionState;
	getDoc: DocumentGetter;
	getBlockElByPath: BlockElLookup;
	getEditorRoot: () => HTMLElement | null;
	/** Aborted when the owning editor unmounts. See EDITOR_LIFETIME_KEY. */
	getEditorLifetime: () => AbortSignal | null;
	stickyColumn: StickyColumnState;
	containerEdit: ContainerEditActions;
	blockEdit: BlockEditActions;
	controller: UndoController;

	getCursorOffset: () => number | null;

	/** Svelte's tick() — awaited after mutations so the DOM settles. */
	afterReactivity: () => Promise<void>;
	setPendingCursor: (offset: number) => void;

	/**
	 * Post-mutation hook for cross-block type-replace, called after the typed
	 * character is spliced into the target node's raw. TextEditableBlock uses
	 * it to reparse inline content; CodeBlock doesn't need one.
	 */
	afterRawMutated?: (node: CstNode) => void;
}

export interface CrossBlockHandlers {
	/** Returns true if the event was fully handled (caller should return). */
	handleKeyDown(e: KeyboardEvent): Promise<boolean>;
	handlePointerDown(e: PointerEvent): boolean;
	handlePaste(e: ClipboardEvent): Promise<boolean>;
	handleBeforeInput(e: InputEvent): Promise<boolean>;
	handleCompositionStart(): boolean;
	/**
	 * Cross-block range delete entry for Cut handlers — after they've
	 * synchronously written the collected text to e.clipboardData.
	 */
	performCrossBlockDeleteFromEvent(): Promise<void>;
}

export function createCrossBlockHandlers(ctx: CrossBlockDispatchContext): CrossBlockHandlers {
	const mutationCtx: CrossBlockMutationContext = {
		selection: ctx.selection,
		getDoc: ctx.getDoc,
		getBlockElByPath: ctx.getBlockElByPath,
		controller: ctx.controller,
		pushUndoSnapshot: () =>
			ctx.controller.pushUndoSnapshot(ctx.getIndex(), ctx.getCursorOffset() ?? 0),
		notifyDocMutated: () => ctx.containerEdit.endContainerEdit()
	};

	return {
		handleKeyDown: (e) => handleKeyDown(ctx, mutationCtx, e),
		handlePointerDown: (e) => handlePointerDown(ctx, e),
		handlePaste: (e) => handlePaste(ctx, mutationCtx, e),
		handleBeforeInput: (e) => handleBeforeInput(ctx, mutationCtx, e),
		handleCompositionStart: () => handleCompositionStart(ctx, mutationCtx),
		performCrossBlockDeleteFromEvent: async () => {
			await performCrossBlockDelete(mutationCtx);
		}
	};
}

// ── Keydown ────────────────────────────────────────────────────────────────

async function handleKeyDown(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	e: KeyboardEvent
): Promise<boolean> {
	const { selection } = ctx;

	if (selection.isCrossBlock) {
		const handled = await handleCrossBlockActive(ctx, mutCtx, e);
		if (handled) return true;
	}

	return handleCrossBlockEntry(ctx, e);
}

/** Keystroke dispatch while cross-block mode is already active. */
async function handleCrossBlockActive(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	e: KeyboardEvent
): Promise<boolean> {
	const el = ctx.getEl();
	if (!el) return false;
	const { selection, getDoc, getBlockElByPath } = ctx;
	const myPath = ctx.getMyPath();
	const doc = getDoc();

	// Ctrl+C / Ctrl+X intentionally pass through — the synthetic copy/cut event
	// reaches the block's onCopy/onCut, which writes synchronously via
	// e.clipboardData.setData. Tauri's wry webview refuses
	// navigator.clipboard.writeText in some contexts.

	if (e.key === 'Backspace' || e.key === 'Delete') {
		e.preventDefault();
		await performCrossBlockDelete(mutCtx);
		return true;
	}

	if (e.ctrlKey && e.shiftKey && e.key === 'End') return handleDocEdgeExtend(ctx, e, 'end');
	if (e.ctrlKey && e.shiftKey && e.key === 'Home') return handleDocEdgeExtend(ctx, e, 'start');

	if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) {
		e.preventDefault();
		const focusPath = selection.focus?.path ?? myPath;
		const focusEl = getBlockElByPath(focusPath) ?? el;
		extendFocusToNextBlock(selection, doc, focusEl, focusPath);
		scrollFocusBlockIntoView(selection, getBlockElByPath);
		return true;
	}
	if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {
		e.preventDefault();
		const focusPath = selection.focus?.path ?? myPath;
		const focusEl = getBlockElByPath(focusPath) ?? el;
		const side = e.key === 'ArrowUp' ? ('start' as const) : ('end' as const);
		extendFocusToPreviousBlock(selection, doc, focusEl, focusPath, side);
		scrollFocusBlockIntoView(selection, getBlockElByPath);
		return true;
	}

	if (e.key === 'Escape' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
		e.preventDefault();
		collapseCrossBlock(selection, 'start', getBlockElByPath);
		return true;
	}

	if (!e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
		e.preventDefault();
		collapseCrossBlock(selection, 'start', getBlockElByPath);
		return true;
	}
	if (!e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
		e.preventDefault();
		collapseCrossBlock(selection, 'end', getBlockElByPath);
		return true;
	}

	if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey) {
		e.preventDefault();
		selectWholeDocument(selection, doc, getBlockElByPath);
		return true;
	}

	return false;
}

function handleCrossBlockEntry(ctx: CrossBlockDispatchContext, e: KeyboardEvent): boolean {
	const el = ctx.getEl();
	if (!el) return false;
	const { selection, getDoc } = ctx;

	if (e.ctrlKey && e.shiftKey && e.key === 'End') return handleDocEdgeExtend(ctx, e, 'end');
	if (e.ctrlKey && e.shiftKey && e.key === 'Home') return handleDocEdgeExtend(ctx, e, 'start');

	if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey) {
		e.preventDefault();
		selection.incrementSelectAllCount();
		if (selection.selectAllCount === 1) {
			selectFirstPressContent(el);
			return true;
		}
		selectWholeDocument(selection, getDoc(), ctx.getBlockElByPath);
		return true;
	}

	return false;
}

// ── Keydown Helpers ───────────────────────────────────────────────────────

/**
 * Select the block's content for the first Ctrl+A press. When a container
 * contributes an ambient marker (e.g. a list item's `- `), anchor after the
 * marker so type-replace doesn't corrupt the contenteditable="false" island.
 */
function selectFirstPressContent(el: HTMLElement): void {
	const ambient = ambientSpanOf(el);
	const ambientLen = ambient?.textContent?.length ?? 0;
	const textLen = el.textContent?.length ?? 0;

	if (ambient && textLen > ambientLen) {
		if (!placeCaretAfterAmbientSpan(el)) return;
		const endRange = createRangeFromOffsets(el, textLen, textLen);
		if (endRange) {
			window.getSelection()?.extend(endRange.endContainer, endRange.endOffset);
		}
		return;
	}

	const range = document.createRange();
	range.selectNodeContents(el);
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}

function handleDocEdgeExtend(
	ctx: CrossBlockDispatchContext,
	e: KeyboardEvent,
	direction: 'start' | 'end'
): boolean {
	const el = ctx.getEl();
	if (!el) return false;
	e.preventDefault();
	extendFocusToDocEdge(ctx.selection, ctx.getDoc(), el, ctx.getMyPath(), direction);
	scrollFocusBlockIntoView(ctx.selection, ctx.getBlockElByPath);
	return true;
}

// ── Pointer ────────────────────────────────────────────────────────────────

function handlePointerDown(ctx: CrossBlockDispatchContext, e: PointerEvent): boolean {
	const el = ctx.getEl();
	if (!el) return false;
	const { selection } = ctx;
	const myPath = ctx.getMyPath();

	ctx.stickyColumn.reset();
	selection.resetSelectAllCount();

	if (e.shiftKey) {
		const prevActive = document.activeElement;
		const prevFocusEl =
			prevActive instanceof HTMLElement && prevActive !== el
				? (prevActive.closest('[contenteditable]') as HTMLElement | null)
				: null;
		const prevFocusPath = findBlockPathForElement(prevActive);
		const handled = handleShiftClick(
			selection,
			el,
			myPath,
			e.clientX,
			e.clientY,
			prevFocusEl,
			prevFocusPath
		);
		if (handled) {
			e.preventDefault();
			return true;
		}
	}

	if (selection.isCrossBlock && !e.shiftKey) {
		selection.clear();
		clearNativeSelection();
	}

	if (!e.shiftKey) {
		const root = ctx.getEditorRoot();
		if (!root) return false;
		const offset = offsetFromViewportPoint(el, e.clientX, e.clientY);
		if (offset === null) return false;
		installDragListener(
			{
				editorRoot: root,
				scrollContainer: root,
				selection,
				getBlockElByPath: ctx.getBlockElByPath,
				lifetimeSignal: ctx.getEditorLifetime() ?? undefined
			},
			{ path: myPath.slice(), offset }
		);
	}

	return false;
}

// ── Paste ──────────────────────────────────────────────────────────────────

async function handlePaste(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	e: ClipboardEvent
): Promise<boolean> {
	if (!ctx.selection.isCrossBlock) return false;

	ctx.stickyColumn.reset();
	e.preventDefault();
	const pasted = normalizeLineEndings(e.clipboardData?.getData('text/plain') ?? '');
	if (!pasted) return true;

	// One snapshot covers the whole delete-then-paste so Ctrl+Z doesn't leave
	// an intermediate "selection-deleted but blocks-not-inserted" state.
	mutCtx.pushUndoSnapshot();

	const doc = ctx.getDoc();
	const caret = await performCrossBlockDelete(mutCtx, {
		skipSnapshot: true,
		skipCaretRestore: true
	});
	if (!caret) return true;

	const result = await pasteDispatch(
		{
			pastedText: pasted,
			targetPath: caret.path,
			offset: caret.offset
		},
		{
			doc,
			blockEdit: ctx.blockEdit,
			controller: ctx.controller,
			skipSnapshot: true
		}
	);
	ctx.containerEdit.endContainerEdit();

	// Place the caret via DOM rather than pendingCursor — the originating
	// block may have been removed by the cross-block delete, leaving a
	// pendingCursor write addressed to an unmounted component.
	if (result.inlineCaretOffset !== undefined) {
		await ctx.afterReactivity();
		const inlineEl = ctx.getBlockElByPath(caret.path);
		if (inlineEl) {
			applyCollapsedCaret(inlineEl, {
				path: caret.path,
				offset: result.inlineCaretOffset
			});
			inlineEl.focus();
		}
	}
	return true;
}

function rebuildAncestryForLeaf(doc: Document, leafPath: number[]): void {
	for (let depth = leafPath.length - 1; depth >= 1; depth--) {
		const ancestor = nodeAt(doc, leafPath.slice(0, depth));
		if (!ancestor || !('kind' in ancestor)) break;
		rebuildContainerRawIfContainer(ancestor as CstNode);
	}
}

// ── BeforeInput ────────────────────────────────────────────────────────────

async function handleBeforeInput(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	e: InputEvent
): Promise<boolean> {
	if (!ctx.selection.isCrossBlock || e.inputType !== 'insertText') return false;

	e.preventDefault();
	const typed = e.data ?? '';
	const caret = await performCrossBlockDelete(mutCtx);
	if (!caret || !typed) return true;

	const doc = ctx.getDoc();
	const targetNode = nodeAt(doc, caret.path) as CstNode | null;
	if (!targetNode || !('raw' in targetNode)) return true;
	targetNode.raw =
		targetNode.raw.slice(0, caret.offset) + typed + targetNode.raw.slice(caret.offset);
	ctx.afterRawMutated?.(targetNode);
	// Originating block's containerEdit bracket may not share the merge
	// target's ancestry; rebuild directly so list/blockquote raws reflect
	// the typed character.
	rebuildAncestryForLeaf(doc, caret.path);
	ctx.containerEdit.endContainerEdit();
	ctx.setPendingCursor(caret.offset + typed.length);
	return true;
}

// ── CompositionStart ───────────────────────────────────────────────────────

function handleCompositionStart(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext
): boolean {
	ctx.stickyColumn.reset();
	if (!ctx.selection.isCrossBlock) return false;
	performCrossBlockDeleteSync(mutCtx);
	return true;
}
