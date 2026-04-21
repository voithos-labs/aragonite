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
	stickyColumn: StickyColumnState;
	containerEdit: ContainerEditActions;
	blockEdit: BlockEditActions;
	controller: UndoController;

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
	/**
	 * Trigger a cross-block range delete without reading from a keyboard event.
	 * Called by the block-local Cut handlers after they've synchronously
	 * written the collected cross-block text to e.clipboardData.
	 */
	performCrossBlockDeleteFromEvent(): Promise<void>;
}

export function createCrossBlockHandlers(ctx: CrossBlockDispatchContext): CrossBlockHandlers {
	const mutationCtx: CrossBlockMutationContext = {
		selection: ctx.selection,
		getDoc: ctx.getDoc,
		getBlockElByPath: ctx.getBlockElByPath,
		controller: ctx.controller,
		// Used by the paste path to push a snapshot covering delete + paste as
		// one undo entry, before calling performCrossBlockDelete with skipSnapshot.
		pushUndoSnapshot: () =>
			ctx.controller.pushUndoSnapshot(ctx.getIndex(), ctx.getCursorOffset() ?? 0),
		// Used by the sync path (compositionstart) and legacy callers.
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

	// Ctrl+C / Ctrl+X are NOT intercepted here — letting the keydown default
	// fire produces a synthetic copy/cut event which the block's own
	// onCopy/onCut handler receives. That handler, inside a user-gesture
	// context, writes synchronously via e.clipboardData.setData — reliable
	// in tauri's wry webview, which refuses navigator.clipboard.writeText in
	// some contexts.

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

	// Escape collapses to the start — matches "get me out of this weird state"
	// user expectation from Obsidian / VS Code / Notion.
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

	// One snapshot covers the whole delete-then-paste — the cross-block
	// delete and the paste mutation share a single undo entry. Pre-fix,
	// the nested structural path produced two snapshots (the implicit
	// one inside performCrossBlockDelete plus another inside
	// insertParsedBlocks), so a single Ctrl+Z left the document in an
	// intermediate "selection-deleted but blocks-not-inserted" state.
	mutCtx.pushUndoSnapshot();

	const doc = ctx.getDoc();
	const caret = await performCrossBlockDelete(mutCtx, {
		skipSnapshot: true,
		skipCaretRestore: true
	});
	if (!caret) return true;

	// Route through the unified dispatcher. skipSnapshot: true threads
	// into the mutation APIs so the whole delete-then-paste lands as one
	// undo entry under the snapshot we already pushed.
	const result = await pasteDispatch(
		{
			pastedText: pasted,
			targetPath: caret.path,
			offset: caret.offset
		},
		{
			doc,
			blockEdit: ctx.blockEdit,
			skipSnapshot: true
		}
	);
	ctx.containerEdit.endContainerEdit();

	// For inline paste, the dispatcher mutated raw directly. Place the
	// caret on the merged block via DOM — the originating block (whose
	// handler fired the paste) may have been removed by the cross-block
	// delete when the user extended selection upward, leaving its
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

/** Rebuild container raw for every ancestor of a leaf path, innermost-first. */
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
	// Mirror the inline-paste path: when the collapsed caret lives inside a
	// container, the originating block's containerEdit bracket may not share
	// the merge target's ancestry. Walk the target's path and rebuild raw
	// directly so list/blockquote `raw` fields reflect the typed character.
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
