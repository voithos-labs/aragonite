/**
 * Shared cross-block event handling extracted from TextEditableBlock and
 * CodeBlock. Both block types need identical logic for cross-block
 * keyboard dispatch, pointer events, clipboard, and composition — the
 * only differences are single-block handling (kept in each component).
 *
 * The factory takes a surface context describing the block's state and
 * editor dependencies, and returns handler functions that each component
 * calls at the top of its own event handlers.
 */

import type { SelectionState } from './selection-state.svelte';
import type { SelectionPoint } from './selection-types';
import type { BlockElLookup, BlockEditActions, ContainerEditActions, DocumentGetter } from '../context-keys';
import type { CstNode, Document } from '../core/nodes';
import type { StickyColumnState } from '../contenteditable/sticky-column';
import type { CrossBlockMutationContext } from './cross-block-ops';
import { collectCrossBlockText } from './clipboard-text';
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
import { findBlockPathForElement, nodeAt } from './path-lookup';
import { clearNativeSelection, offsetFromViewportPoint } from './native-bridge';
import { installDragListener } from './drag-pointer';
import { parse } from '../core/parser';
import { trimTrailingLineEnding } from '../raw-text';
import { rebuildContainerRawIfContainer } from '../tree-operations/generic';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockSurfaceContext {
	getEl: () => HTMLElement | null;
	getMyPath: () => number[];
	getIndex: () => number;

	selection: SelectionState;
	getDoc: DocumentGetter;
	getBlockElByPath: BlockElLookup;
	getEditorRoot: () => HTMLElement | null;
	stickyColumn: StickyColumnState;
	containerEdit: ContainerEditActions;
	blockEdit: BlockEditActions;

	getCursorOffset: () => number | null;

	/** Svelte's tick() — awaited after mutations so the DOM settles. */
	afterReactivity: () => Promise<void>;
	/** Set the block's pendingCursorOffset state. */
	setPendingCursor: (offset: number) => void;

	/**
	 * Optional post-mutation hook for cross-block type-replace. Called after
	 * the factory splices the typed character into the target node's raw.
	 * TextEditableBlock uses this to reparse inline content; CodeBlock
	 * needs no post-processing.
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
}

export function createCrossBlockHandlers(ctx: CrossBlockSurfaceContext): CrossBlockHandlers {
	const mutationCtx: CrossBlockMutationContext = {
		selection: ctx.selection,
		getDoc: ctx.getDoc,
		getBlockElByPath: ctx.getBlockElByPath,
		pushUndoSnapshot: () =>
			ctx.containerEdit.beginContainerEdit(ctx.getIndex(), ctx.getCursorOffset() ?? 0),
		notifyDocMutated: () => ctx.containerEdit.endContainerEdit()
	};

	return {
		handleKeyDown: (e) => handleKeyDown(ctx, mutationCtx, e),
		handlePointerDown: (e) => handlePointerDown(ctx, e),
		handlePaste: (e) => handlePaste(ctx, mutationCtx, e),
		handleBeforeInput: (e) => handleBeforeInput(ctx, mutationCtx, e),
		handleCompositionStart: () => handleCompositionStart(ctx, mutationCtx)
	};
}

// ── Keydown ────────────────────────────────────────────────────────────────

async function handleKeyDown(
	ctx: CrossBlockSurfaceContext,
	mutCtx: CrossBlockMutationContext,
	e: KeyboardEvent
): Promise<boolean> {
	const { selection } = ctx;

	// While cross-block is active, dispatch extend/collapse/clipboard first.
	if (selection.isCrossBlock) {
		const handled = await handleCrossBlockActive(ctx, mutCtx, e);
		if (handled) return true;
	}

	// Single-block entry points: Ctrl+Shift+Home/End, double Ctrl+A.
	return handleCrossBlockEntry(ctx, e);
}

/** Keystroke dispatch while cross-block mode is already active. */
async function handleCrossBlockActive(
	ctx: CrossBlockSurfaceContext,
	mutCtx: CrossBlockMutationContext,
	e: KeyboardEvent
): Promise<boolean> {
	const el = ctx.getEl();
	if (!el) return false;
	const { selection, getDoc, getBlockElByPath } = ctx;
	const myPath = ctx.getMyPath();
	const doc = getDoc();

	// Cross-block Copy
	if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey) {
		e.preventDefault();
		const text = collectCrossBlockText(doc, selection.anchor!, selection.focus!);
		await navigator.clipboard.writeText(text);
		return true;
	}

	// Cross-block Cut
	if ((e.ctrlKey || e.metaKey) && e.key === 'x' && !e.shiftKey) {
		e.preventDefault();
		const text = collectCrossBlockText(doc, selection.anchor!, selection.focus!);
		await navigator.clipboard.writeText(text);
		await performCrossBlockDelete(mutCtx, ctx.afterReactivity);
		return true;
	}

	if (e.key === 'Backspace' || e.key === 'Delete') {
		e.preventDefault();
		await performCrossBlockDelete(mutCtx, ctx.afterReactivity);
		return true;
	}

	if (e.ctrlKey && e.shiftKey && e.key === 'End') return handleDocEdgeExtend(ctx, e, 'end');
	if (e.ctrlKey && e.shiftKey && e.key === 'Home') return handleDocEdgeExtend(ctx, e, 'start');

	if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) {
		e.preventDefault();
		const focusPath = selection.focus?.path ?? myPath;
		extendFocusToNextBlock(selection, doc, el, focusPath);
		scrollFocusBlockIntoView(selection, getBlockElByPath);
		return true;
	}
	if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {
		e.preventDefault();
		const focusPath = selection.focus?.path ?? myPath;
		const side = e.key === 'ArrowUp' ? 'start' as const : 'end' as const;
		extendFocusToPreviousBlock(selection, doc, el, focusPath, side);
		scrollFocusBlockIntoView(selection, getBlockElByPath);
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

	// Ctrl+A while already cross-block: select the whole document.
	if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey) {
		e.preventDefault();
		selectWholeDocument(selection, doc);
		return true;
	}

	return false;
}

/** Single-block entry points that don't need boundary geometry checks. */
function handleCrossBlockEntry(
	ctx: CrossBlockSurfaceContext,
	e: KeyboardEvent
): boolean {
	const el = ctx.getEl();
	if (!el) return false;
	const { selection, getDoc } = ctx;

	if (e.ctrlKey && e.shiftKey && e.key === 'End') return handleDocEdgeExtend(ctx, e, 'end');
	if (e.ctrlKey && e.shiftKey && e.key === 'Home') return handleDocEdgeExtend(ctx, e, 'start');

	if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey) {
		e.preventDefault();
		selection.incrementSelectAllCount();
		if (selection.selectAllCount === 1) {
			const range = document.createRange();
			range.selectNodeContents(el);
			const sel = window.getSelection();
			sel?.removeAllRanges();
			sel?.addRange(range);
			return true;
		}
		selectWholeDocument(selection, getDoc());
		return true;
	}

	return false;
}

// ── Keydown Helpers ───────────────────────────────────────────────────────

/** Shared handler for Ctrl+Shift+Home / Ctrl+Shift+End in both active and entry paths. */
function handleDocEdgeExtend(ctx: CrossBlockSurfaceContext, e: KeyboardEvent, direction: 'start' | 'end'): boolean {
	const el = ctx.getEl();
	if (!el) return false;
	e.preventDefault();
	extendFocusToDocEdge(ctx.selection, ctx.getDoc(), el, ctx.getMyPath(), direction);
	scrollFocusBlockIntoView(ctx.selection, ctx.getBlockElByPath);
	return true;
}

// ── Pointer ────────────────────────────────────────────────────────────────

function handlePointerDown(
	ctx: CrossBlockSurfaceContext,
	e: PointerEvent
): boolean {
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

	// Collapse a live cross-block selection on unshifted click.
	if (selection.isCrossBlock && !e.shiftKey) {
		selection.clear();
		clearNativeSelection();
	}

	// Install drag listener for potential cross-block drag selection.
	if (!e.shiftKey) {
		const root = ctx.getEditorRoot();
		if (!root) return false;
		const offset = offsetFromViewportPoint(el, e.clientX, e.clientY);
		if (offset === null) return false;
		installDragListener(
			{ editorRoot: root, scrollContainer: root, selection },
			{ path: myPath.slice(), offset }
		);
	}

	// Pointer always "handled" — the caller still needs to process the event
	// for single-block concerns, so we return true only when we short-circuited
	// (shift-click entered cross-block mode).
	return false;
}

// ── Paste ──────────────────────────────────────────────────────────────────

async function handlePaste(
	ctx: CrossBlockSurfaceContext,
	mutCtx: CrossBlockMutationContext,
	e: ClipboardEvent
): Promise<boolean> {
	if (!ctx.selection.isCrossBlock) return false;

	ctx.stickyColumn.reset();
	e.preventDefault();
	const pasted = e.clipboardData?.getData('text/plain') ?? '';
	if (!pasted) return true;

	const doc = ctx.getDoc();
	const caret = await performCrossBlockDelete(mutCtx, ctx.afterReactivity);
	if (!caret) return true;
	const targetNode = nodeAt(doc, caret.path) as CstNode | null;
	if (!targetNode || !('raw' in targetNode)) return true;
	const parsed = parse(pasted);

	// Multi-block paste: only safe via the top-level blockEdit, which expects
	// a FLAT top-level index. Paths deeper than [idx] would break the splice
	// (the nested container's blockEdit no-ops insertParsedBlocks). Skip the
	// complex case until a path-aware API lands.
	if (parsed.children.length > 1) {
		if (caret.path.length !== 1) return true;
		ctx.blockEdit.insertParsedBlocks(caret.path[0], caret.offset, parsed.children);
		return true;
	}

	// Single-block paste: splice pasted text into the target node's raw and
	// rebuild any container ancestors so their serialized form reflects the
	// mutated leaf. Mirrors handleBeforeInput's type-replace path, which
	// correctly handles carets arbitrarily deep in container chains.
	const targetDisplay = trimTrailingLineEnding(targetNode.raw);
	const lineEnding = targetNode.raw.endsWith('\r\n') ? '\r\n' : '\n';
	targetNode.raw =
		targetDisplay.slice(0, caret.offset) + pasted + targetDisplay.slice(caret.offset) + lineEnding;
	ctx.afterRawMutated?.(targetNode);
	rebuildAncestryForLeaf(doc, caret.path);
	ctx.containerEdit.endContainerEdit();
	ctx.setPendingCursor(caret.offset + pasted.length);
	return true;
}

/**
 * Rebuild container raw for every ancestor of a leaf path, innermost-first.
 * Stops before the document root — serialization reads top-level children
 * directly, so the document itself never needs rebuild. Mirrors the local
 * walker in rangeDelete and keeps paste/type-replace ancestries fresh.
 */
function rebuildAncestryForLeaf(doc: Document, leafPath: number[]): void {
	for (let depth = leafPath.length - 1; depth >= 1; depth--) {
		const ancestor = nodeAt(doc, leafPath.slice(0, depth));
		if (!ancestor || !('kind' in ancestor)) break;
		rebuildContainerRawIfContainer(ancestor as CstNode);
	}
}

// ── BeforeInput ────────────────────────────────────────────────────────────

async function handleBeforeInput(
	ctx: CrossBlockSurfaceContext,
	mutCtx: CrossBlockMutationContext,
	e: InputEvent
): Promise<boolean> {
	if (!ctx.selection.isCrossBlock || e.inputType !== 'insertText') return false;

	e.preventDefault();
	const typed = e.data ?? '';
	const caret = await performCrossBlockDelete(mutCtx, ctx.afterReactivity);
	if (!caret || !typed) return true;

	const targetNode = nodeAt(ctx.getDoc(), caret.path) as CstNode | null;
	if (!targetNode || !('raw' in targetNode)) return true;
	targetNode.raw = targetNode.raw.slice(0, caret.offset) + typed + targetNode.raw.slice(caret.offset);
	ctx.afterRawMutated?.(targetNode);
	ctx.containerEdit.endContainerEdit();
	ctx.setPendingCursor(caret.offset + typed.length);
	return true;
}

// ── CompositionStart ───────────────────────────────────────────────────────

function handleCompositionStart(
	ctx: CrossBlockSurfaceContext,
	mutCtx: CrossBlockMutationContext
): boolean {
	ctx.stickyColumn.reset();
	if (!ctx.selection.isCrossBlock) return false;
	performCrossBlockDeleteSync(mutCtx);
	return true;
}
