/**
 * Keydown + compositionstart half of the cross-block dispatcher. See dispatch.ts for the
 * composer that wires this together with the pointer half.
 */

import type { CrossBlockMutationContext } from './ops';
import type { CrossBlockDispatchContext } from './dispatch';
import type { AnyBlockKind, CstNode, Document } from '../../core/nodes';
import { performCrossBlockDelete, performCrossBlockDeleteSync } from './ops';
import { isBlockNode } from '../../tree-operations/node-ops';
import { isReadingMode } from '../../presentation-mode';
import { eventToChord } from '../../schema/keybindings';
import { dispatchKeyCommand } from '../../schema/block-commands';
import {
	collapseCrossBlock,
	extendFocusToNextBlock,
	extendFocusToPreviousBlock,
	extendFocusToDocEdge,
	selectWholeDocument,
	scrollFocusBlockIntoView
} from '../keyboard-extend';
import { cellEndpointDeepPath } from '../table-endpoint-snap';
import { intraTableRectExtension } from '../table-rect-extend';
import { ambientSpanOf, placeCaretAfterAmbientSpan } from '../../ambient/ambient-dom';
import { asDomTextOffset } from '../../cursor/coordinate-spaces';
import { createRangeFromOffsets } from '../../cursor/content-offsets';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockKeydown {
	handleKeyDown(e: KeyboardEvent): Promise<boolean>;
	handleCompositionStart(): boolean;
}

export function createCrossBlockKeydown(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext
): CrossBlockKeydown {
	return {
		handleKeyDown: (e) => handleKeyDown(ctx, mutCtx, e),
		handleCompositionStart: () => handleCompositionStart(ctx, mutCtx)
	};
}

// ── Keydown ────────────────────────────────────────────────────────────────

async function handleKeyDown(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	e: KeyboardEvent
): Promise<boolean> {
	const { selection } = ctx;

	// Before the dispatch, not after: every branch below can consume the key and return, and the
	// collapse/extend arms run no commit, so a reset deferred to the shared prelude never fires.
	// The dispatcher holds a range, not a caret, so it supplies no measurement.
	ctx.stickyColumn.noteKey(e);

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

	// Ctrl+C / Ctrl+X intentionally pass through: the copy/cut event writes synchronously via
	// e.clipboardData.setData, since Tauri's wry webview refuses navigator.clipboard.writeText.
	// Without a caret at the endpoint Chromium retargets to <body>, caught by
	// components/editor-root-clipboard.ts.

	// Extend/collapse/copy stay live in reading mode; these two branches delete.
	if (e.key === 'Backspace' || e.key === 'Delete') {
		e.preventDefault();
		if (isReadingMode(ctx.getPresentationMode)) return true;
		await performCrossBlockDelete(mutCtx, { tableCoverageDelete: true });
		return true;
	}

	if (isCommandCandidateKey(e)) {
		e.preventDefault();
		if (isReadingMode(ctx.getPresentationMode)) return true;
		// Reveal at the delete's own caret, not the pre-delete start path: rangeDelete returns
		// the authoritative post-delete position, and for a table endpoint that is the deep
		// [table,row,col] cell whose runCommand exists (the wrapper path has none).
		const fallbackPath = (selection.start ?? selection.focus)?.path ?? myPath;
		const collapsedCaret = await performCrossBlockDelete(mutCtx);
		await ctx.afterReactivity();
		const postDeleteDoc = getDoc();
		const revealTarget = collapsedCaret?.path ?? fallbackPath;
		const target = await ctx.revealPath(revealTarget);
		const chord = eventToChord(e);
		if (target?.runCommand && chord) {
			dispatchKeyCommand(
				chord,
				{ kind: kindOfPath(revealTarget, postDeleteDoc), runCommand: target.runCommand },
				{
					history: ctx.history,
					pluginEditor: ctx.pluginEditor,
					getPresentationMode: ctx.getPresentationMode
				},
				ctx.getKeybindingOverrides(),
				ctx.onCommandError
			);
		}
		return true;
	}

	if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'End')
		return handleDocEdgeExtend(ctx, e, 'end');
	if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Home')
		return handleDocEdgeExtend(ctx, e, 'start');

	// Intra-table rectangle: Shift+Arrow grows the rect cell-by-cell and exits at the vertical
	// edge. Must precede the generic extend, which snaps the focus back to cellIdx 0.
	if (
		e.shiftKey &&
		(e.key === 'ArrowUp' ||
			e.key === 'ArrowDown' ||
			e.key === 'ArrowLeft' ||
			e.key === 'ArrowRight')
	) {
		const ext = intraTableRectExtension(doc, selection.anchor, selection.focus, e.key);
		if (ext) {
			e.preventDefault();
			if (ext.kind === 'cell') {
				selection.extendFocus({ path: selection.focus!.path.slice(), offset: ext.offset });
			} else if (ext.direction === 'forward') {
				extendFocusToNextBlock(selection, doc, el, ext.fromCellPath, 'vertical');
			} else {
				extendFocusToPreviousBlock(selection, doc, el, ext.fromCellPath, 'start');
			}
			await revealActiveEndpoint(ctx);
			return true;
		}
	}

	if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) {
		e.preventDefault();
		const focusPath = selection.focus?.path ?? myPath;
		const focusEl = getBlockElByPath(focusPath) ?? el;
		const axis = e.key === 'ArrowDown' ? ('vertical' as const) : ('horizontal' as const);
		extendFocusToNextBlock(selection, doc, focusEl, focusPath, axis, getBlockElByPath);
		await revealActiveEndpoint(ctx);
		return true;
	}
	if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {
		e.preventDefault();
		const focusPath = selection.focus?.path ?? myPath;
		const focusEl = getBlockElByPath(focusPath) ?? el;
		const side = e.key === 'ArrowUp' ? ('start' as const) : ('end' as const);
		extendFocusToPreviousBlock(selection, doc, focusEl, focusPath, side, getBlockElByPath);
		await revealActiveEndpoint(ctx);
		return true;
	}

	if (e.key === 'Escape' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
		e.preventDefault();
		await collapseCrossBlock(selection, 'start', doc, getBlockElByPath, ctx.revealPath);
		return true;
	}

	if (!e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
		e.preventDefault();
		await collapseCrossBlock(selection, 'start', doc, getBlockElByPath, ctx.revealPath);
		return true;
	}
	if (!e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
		e.preventDefault();
		await collapseCrossBlock(selection, 'end', doc, getBlockElByPath, ctx.revealPath);
		return true;
	}

	if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey) {
		e.preventDefault();
		selectWholeDocument(selection, doc, getBlockElByPath);
		return true;
	}

	return false;
}

/** The first-press arm; `handleCrossBlockActive` carries the identical chord set for the
 *  already-cross-block case, so a chord added here is owed there too. */
async function handleCrossBlockEntry(
	ctx: CrossBlockDispatchContext,
	e: KeyboardEvent
): Promise<boolean> {
	const el = ctx.getEl();
	if (!el) return false;
	const { selection, getDoc } = ctx;

	if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'End')
		return handleDocEdgeExtend(ctx, e, 'end');
	if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Home')
		return handleDocEdgeExtend(ctx, e, 'start');

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
 * Keys owned by the block-level handler at the caret, which must run at a collapsed caret
 * rather than over stale block indices. After the range delete they dispatch through the
 * merged block's command registry.
 */
function isCommandCandidateKey(e: KeyboardEvent): boolean {
	if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) return true;
	if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) return true;
	if (
		(e.ctrlKey || e.metaKey) &&
		!e.shiftKey &&
		!e.altKey &&
		(e.key === 'b' || e.key === 'B' || e.key === 'i' || e.key === 'I')
	)
		return true;
	if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[0-6]$/.test(e.key)) return true;
	return false;
}

/** Deepest resolvable node's kind; an empty/unresolvable path reads the document root's own kind. */
function kindOfPath(path: number[], doc: Document): AnyBlockKind {
	let node: CstNode | Document = doc;
	for (const i of path) {
		const child: CstNode | undefined = node.children?.[i];
		if (!child) break;
		node = child;
	}
	// The root's 'document' kind is outside AnyBlockKind; dispatch treats it as an unknown kind.
	return isBlockNode(node) ? node.kind : (node.kind as AnyBlockKind);
}

/**
 * Select the block's content for the first Ctrl+A press. With an ambient marker (a list item's
 * `- `), anchor after it so type-replace doesn't corrupt the contenteditable="false" island.
 */
function selectFirstPressContent(el: HTMLElement): void {
	const ambient = ambientSpanOf(el);
	const ambientLen = ambient?.textContent?.length ?? 0;
	const textLen = el.textContent?.length ?? 0;

	if (ambient && textLen > ambientLen) {
		if (!placeCaretAfterAmbientSpan(el)) return;
		// textLen counts the full textContent (marker included) — a DomTextOffset by construction.
		const endRange = createRangeFromOffsets(el, asDomTextOffset(textLen), asDomTextOffset(textLen));
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

/**
 * Bring the active (focus-side) endpoint into view after an extend. A cell-coordinate focus
 * addresses the table block by cell index, so reveal the deep cell path to mount the off-window
 * row, then park the dispatch caret there to keep the next keystroke routed. Start, not end: an
 * end caret in the last cell makes ArrowRight read as an exit-the-table move. `parkCaret`, never
 * `focus`: this landing runs WHILE an extend grows, and `focus` would end the range (G2.12).
 */
async function revealActiveEndpoint(ctx: CrossBlockDispatchContext): Promise<void> {
	const focus = ctx.selection.focus;
	const deepPath = focus && cellEndpointDeepPath(ctx.getDoc(), focus);
	if (deepPath) {
		const cellRef = await ctx.revealPath(deepPath);
		// A null ref means the cell never mounted; fall through to scroll the (mounted) table
		// so a failed reveal still keeps the endpoint in view.
		if (cellRef) {
			cellRef.parkCaret?.(0);
			return;
		}
	}
	// An off-window prose endpoint can't be scrolled to while unmounted. Reveal it and park the
	// dispatch caret in it, the same reveal-then-pin pattern as the table-cell case above.
	if (focus && !ctx.getBlockElByPath(focus.path)) {
		const ref = await ctx.revealPath(focus.path);
		if (ref) {
			ref.parkCaret?.(focus.offset);
			scrollFocusBlockIntoView(ctx.selection, ctx.getBlockElByPath);
			return;
		}
	}
	scrollFocusBlockIntoView(ctx.selection, ctx.getBlockElByPath);
}

async function handleDocEdgeExtend(
	ctx: CrossBlockDispatchContext,
	e: KeyboardEvent,
	direction: 'start' | 'end'
): Promise<boolean> {
	const el = ctx.getEl();
	if (!el) return false;
	e.preventDefault();
	extendFocusToDocEdge(
		ctx.selection,
		ctx.getDoc(),
		el,
		ctx.getMyPath(),
		direction,
		ctx.getBlockElByPath
	);
	await revealActiveEndpoint(ctx);
	return true;
}

// ── CompositionStart ───────────────────────────────────────────────────────

function handleCompositionStart(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext
): boolean {
	ctx.stickyColumn.reset();
	ctx.edgeAffinity.reset();
	if (!ctx.selection.isCrossBlock) return false;
	if (isReadingMode(ctx.getPresentationMode)) return false;
	performCrossBlockDeleteSync(mutCtx);
	return true;
}
