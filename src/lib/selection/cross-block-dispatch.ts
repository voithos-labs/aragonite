/**
 * Cross-block event dispatch shared by TextEditableBlock and CodeBlock.
 * Both block types need identical logic for cross-block keyboard
 * handling, pointer events, clipboard, and composition — the only
 * differences are single-block handling (kept in each component).
 *
 * The factory takes a dispatch context describing the block's state and
 * editor dependencies, and returns handler functions that each component
 * calls at the top of its own event handlers.
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
import {
	applyCollapsedCaret,
	clearNativeSelection,
	offsetFromViewportPoint
} from './native-bridge';
import { installDragListener } from './drag-pointer';
import { parse } from '../core/parser';
import { displayLength, trimTrailingLineEnding } from '../core/lines';
import { rebuildContainerRawIfContainer } from '../tree-operations/container-raw';
import { buildPastedReplacement } from '../tree-operations/paste-replacement';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockDispatchContext {
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

export function createCrossBlockHandlers(ctx: CrossBlockDispatchContext): CrossBlockHandlers {
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
	ctx: CrossBlockDispatchContext,
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
	ctx: CrossBlockDispatchContext,
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
		const side = e.key === 'ArrowUp' ? ('start' as const) : ('end' as const);
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
		selectWholeDocument(selection, doc, getBlockElByPath);
		return true;
	}

	return false;
}

/** Single-block entry points that don't need boundary geometry checks. */
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
			const range = document.createRange();
			range.selectNodeContents(el);
			const sel = window.getSelection();
			sel?.removeAllRanges();
			sel?.addRange(range);
			return true;
		}
		selectWholeDocument(selection, getDoc(), ctx.getBlockElByPath);
		return true;
	}

	return false;
}

// ── Keydown Helpers ───────────────────────────────────────────────────────

/** Shared handler for Ctrl+Shift+Home / Ctrl+Shift+End in both active and entry paths. */
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
			{
				editorRoot: root,
				scrollContainer: root,
				selection,
				getBlockElByPath: ctx.getBlockElByPath
			},
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
	ctx: CrossBlockDispatchContext,
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

	// Multi-block paste. Top-level carets dispatch via the root blockEdit
	// (always live). Nested carets can't use `ctx.blockEdit` — that bundle is
	// the bundle of the block that originally received the paste event, and
	// `performCrossBlockDelete` above may have removed that block's
	// container from the tree, leaving the bundle pointing at an orphaned
	// node. Splice directly into the caret's parent container's children;
	// BlockListState's auto-sync `$effect` regenerates ids/refs when the
	// children-array length changes.
	if (parsed.children.length > 1) {
		if (caret.path.length === 1) {
			ctx.blockEdit.insertParsedBlocks(caret.path[0], caret.offset, parsed.children);
			return true;
		}
		const parentPath = caret.path.slice(0, -1);
		const parent = nodeAt(doc, parentPath) as CstNode | null;
		const innerIndex = caret.path[caret.path.length - 1];
		if (!parent?.children || innerIndex < 0 || innerIndex >= parent.children.length) {
			return true;
		}
		const leaf = parent.children[innerIndex];
		const replacement = buildPastedReplacement(leaf, caret.offset, parsed.children);
		parent.children.splice(innerIndex, 1, ...replacement);
		rebuildAncestryForLeaf(doc, [...parentPath, innerIndex]);
		ctx.containerEdit.endContainerEdit();
		await ctx.afterReactivity();
		focusLastInsertedBlock(ctx, [...parentPath, innerIndex + replacement.length - 1]);
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
 * After a nested multi-block paste, land the caret at the end of the last
 * inserted block using DOM-level focus — the block component instance (and
 * its BlockComponent.focus method) isn't reachable from the root dispatch
 * context, but applyCollapsedCaret + el.focus() achieves the same result.
 */
function focusLastInsertedBlock(ctx: CrossBlockDispatchContext, lastPath: number[]): void {
	const blockEl = ctx.getBlockElByPath(lastPath);
	if (!blockEl) return;
	const doc = ctx.getDoc();
	const lastNode = nodeAt(doc, lastPath) as CstNode | null;
	const offset = lastNode?.raw ? displayLength(lastNode.raw) : 0;
	applyCollapsedCaret(blockEl, { path: lastPath, offset });
	blockEl.focus();
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
	ctx: CrossBlockDispatchContext,
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
	targetNode.raw =
		targetNode.raw.slice(0, caret.offset) + typed + targetNode.raw.slice(caret.offset);
	ctx.afterRawMutated?.(targetNode);
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
