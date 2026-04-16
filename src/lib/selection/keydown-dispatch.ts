/**
 * Cross-block keyboard dispatch. Pure helpers the focus block's onKeyDown /
 * onPointerDown handlers call when the event needs to enter, extend, or
 * collapse cross-block mode.
 *
 * Each helper returns `true` when it handled the event (caller should
 * preventDefault and return), `false` otherwise. No helper has any state of
 * its own — SelectionState holds the cross-block anchor/focus and every
 * callable reads or writes through it explicitly.
 *
 * See docs/superpowers/specs/2026-04-15-v0.4-selection-clipboard-design.md
 * Keyboard Dispatch section for the dispatch table.
 */

import type { SelectionState } from './selection-state.svelte';
import type { SelectionPoint } from './selection-types';
import type { CstNode, Document } from '../core/nodes';
import {
	readNativeCaretInBlock,
	applyCollapsedCaret,
	clearNativeSelection,
	offsetFromViewportPoint
} from './native-bridge';
import { nextPath, previousPath, firstPath, lastPath, nodeAt } from './path-lookup';
import { walkBetween } from './range-walker';
import { normalize } from './selection-point';
import { rangeDelete } from './range-delete';
import { displayLength } from '../raw-text';

// ── Enter / collapse / scroll (Batch A) ─────────────────────────────────────

/**
 * Transition from single-block to cross-block mode on a keyboard extension
 * (Shift+Arrow leaving a block). Reads the native caret from
 * `currentBlockEl`, populates SelectionState with that caret as both anchor
 * and focus, then clears the native selection.
 *
 * The caller decides WHERE the focus should land — this function only
 * captures the anchor and enters cross-block mode with `focus === anchor`
 * initially. The caller immediately calls `selection.extendFocus(target)`
 * after this returns true.
 */
export function enterCrossBlockFromKeyboard(
	selection: SelectionState,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[]
): boolean {
	const anchorPoint = readNativeCaretInBlock(currentBlockEl, currentBlockPath);
	if (!anchorPoint) return false;
	selection.enterCrossBlock(anchorPoint, {
		path: anchorPoint.path.slice(),
		offset: anchorPoint.offset
	});
	clearNativeSelection();
	return true;
}

/**
 * Collapse the cross-block selection to its start or end and restore a
 * native caret at that point. Exits cross-block mode.
 */
export function collapseCrossBlock(
	selection: SelectionState,
	to: 'start' | 'end',
	getBlockElByPath: (path: number[]) => HTMLElement | null
): void {
	const target = to === 'start' ? selection.start : selection.end;
	if (!target) return;
	selection.collapse();
	clearNativeSelection();
	const blockEl = getBlockElByPath(target.path);
	if (blockEl) {
		applyCollapsedCaret(blockEl, target);
		blockEl.focus();
	}
}

/**
 * After extending the focus endpoint, scroll the focus block into view.
 * No-op if the focus block is already visible.
 */
export function scrollFocusBlockIntoView(
	selection: SelectionState,
	getBlockElByPath: (path: number[]) => HTMLElement | null
): void {
	if (!selection.focus) return;
	const blockEl = getBlockElByPath(selection.focus.path);
	blockEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ── Keyboard extension (Batch B) ────────────────────────────────────────────

/**
 * Extend cross-block focus to the next leaf block in document order. Called
 * on Shift+ArrowDown / Shift+ArrowRight leaving the current block. Enters
 * cross-block mode first if the selection is still single-block (anchor =
 * native caret).
 *
 * Returns true if focus moved, false if no next leaf exists or entering
 * cross-block mode failed.
 */
export function extendFocusToNextBlock(
	selection: SelectionState,
	doc: Document,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[]
): boolean {
	const target = nextPath(doc, currentBlockPath);
	if (!target) return false;
	const leafTarget = firstLeafAtOrAfter(doc, target);
	if (!leafTarget) return false;

	if (!selection.isCrossBlock) {
		if (!enterCrossBlockFromKeyboard(selection, currentBlockEl, currentBlockPath)) return false;
	}
	selection.extendFocus({ path: leafTarget, offset: 0 });
	return true;
}

/**
 * Extend cross-block focus to the previous leaf block in document order.
 * Called on Shift+ArrowUp / Shift+ArrowLeft leaving the current block.
 * Places focus at the end of the target leaf's raw content.
 */
export function extendFocusToPreviousBlock(
	selection: SelectionState,
	doc: Document,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[]
): boolean {
	const target = previousPath(doc, currentBlockPath);
	if (!target) return false;
	const leafTarget = lastLeafAtOrBefore(doc, target);
	if (!leafTarget) return false;

	if (!selection.isCrossBlock) {
		if (!enterCrossBlockFromKeyboard(selection, currentBlockEl, currentBlockPath)) return false;
	}
	selection.extendFocus({ path: leafTarget, offset: leafOffsetEnd(doc, leafTarget) });
	return true;
}

/**
 * Extend cross-block focus to the document start or end. Called on
 * Ctrl+Shift+Home / Ctrl+Shift+End. Enters cross-block mode first if the
 * selection is still single-block.
 */
export function extendFocusToDocEdge(
	selection: SelectionState,
	doc: Document,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[],
	to: 'start' | 'end'
): boolean {
	const edge = to === 'start' ? firstPath(doc) : lastPath(doc);
	if (!edge) return false;

	if (!selection.isCrossBlock) {
		if (!enterCrossBlockFromKeyboard(selection, currentBlockEl, currentBlockPath)) return false;
	}

	const offset = to === 'end' ? leafOffsetEnd(doc, edge) : 0;
	selection.extendFocus({ path: edge, offset });
	return true;
}

/**
 * Select the entire document as a cross-block range. Used by the second
 * press of Ctrl+A. Anchors at the first leaf's start and focuses at the
 * last leaf's end.
 */
export function selectWholeDocument(selection: SelectionState, doc: Document): boolean {
	const first = firstPath(doc);
	const last = lastPath(doc);
	if (!first || !last) return false;
	selection.enterCrossBlock(
		{ path: first, offset: 0 },
		{ path: last, offset: leafOffsetEnd(doc, last) }
	);
	clearNativeSelection();
	return true;
}

// ── Shift+click (Batch B) ───────────────────────────────────────────────────

/**
 * Handle a Shift+click on a block at a given viewport coordinate. Extends
 * the current cross-block selection or enters cross-block mode using the
 * previously focused block's caret as the anchor.
 *
 * Returns true if the selection was updated, false if no anchor could be
 * recovered or the click stayed within the same block (native shift-click
 * handles single-block selection).
 */
export function handleShiftClick(
	selection: SelectionState,
	clickedBlockEl: HTMLElement,
	clickedBlockPath: number[],
	clickedX: number,
	clickedY: number,
	previouslyFocusedBlockEl: HTMLElement | null,
	previouslyFocusedBlockPath: number[] | null
): boolean {
	const clickOffset = offsetFromViewportPoint(clickedBlockEl, clickedX, clickedY);
	if (clickOffset === null) return false;
	const focusPoint: SelectionPoint = { path: clickedBlockPath.slice(), offset: clickOffset };

	if (selection.isCrossBlock) {
		selection.extendFocus(focusPoint);
		return true;
	}

	if (!previouslyFocusedBlockEl || !previouslyFocusedBlockPath) return false;
	const anchor = readNativeCaretInBlock(previouslyFocusedBlockEl, previouslyFocusedBlockPath);
	if (!anchor) return false;

	// Same-block shift-click — native selection already produced a single-block
	// range, so leave cross-block mode inactive.
	if (pathsEqual(anchor.path, focusPoint.path)) return false;

	selection.enterCrossBlock(anchor, focusPoint);
	clearNativeSelection();
	return true;
}

// ── Cross-block clipboard helpers ──────────────────────────────────────────

/**
 * Collect the plain-text content spanning a cross-block selection. Includes
 * the tail of the start block's raw, the full leadingTrivia + raw of every
 * middle block, and the head of the end block's raw.
 */
export function collectCrossBlockText(
	doc: Document,
	anchor: SelectionPoint,
	focus: SelectionPoint
): string {
	const { start, end } = normalize({ anchor, focus });
	const startNode = nodeAt(doc, start.path);
	const endNode = nodeAt(doc, end.path);
	if (!startNode || !endNode) return '';

	const startRaw = 'raw' in startNode ? (startNode as CstNode).raw : '';
	const endRaw = 'raw' in endNode ? (endNode as CstNode).raw : '';

	const startTail = startRaw.slice(start.offset);
	let middle = '';
	for (const path of walkBetween(doc, start.path, end.path)) {
		const node = nodeAt(doc, path);
		if (!node || !('raw' in node)) continue;
		const lead = 'leadingTrivia' in node ? (node as CstNode).leadingTrivia : '';
		middle += lead + (node as CstNode).raw;
	}
	const endHead = endRaw.slice(0, end.offset);
	return startTail + middle + endHead;
}

/** Everything a cross-block mutation needs from the calling block component. */
export interface CrossBlockMutationContext {
	selection: SelectionState;
	getDoc: () => Document;
	getBlockElByPath: (path: number[]) => HTMLElement | null;
	pushUndoSnapshot: () => void;
	notifyDocMutated: () => void;
}

/**
 * Run rangeDelete on the current cross-block selection, push undo, collapse,
 * and restore the native caret in the merged block. Returns the collapsed
 * caret position, or null if the selection wasn't cross-block.
 */
export async function performCrossBlockDelete(
	ctx: CrossBlockMutationContext,
	afterReactivity: () => Promise<void>
): Promise<SelectionPoint | null> {
	const { start, end } = resolveStartEnd(ctx.selection);
	if (!start || !end) return null;

	ctx.pushUndoSnapshot();
	const { collapsedCaret } = rangeDelete(ctx.getDoc(), start, end);
	ctx.selection.collapse();
	ctx.notifyDocMutated();

	await afterReactivity();

	const blockEl = ctx.getBlockElByPath(collapsedCaret.path);
	if (blockEl) {
		applyCollapsedCaret(blockEl, collapsedCaret);
		blockEl.focus();
	}
	return collapsedCaret;
}

/**
 * Synchronous variant for compositionstart — no await, no caret restore.
 * Returns the collapsed caret position or null.
 */
export function performCrossBlockDeleteSync(
	ctx: CrossBlockMutationContext
): SelectionPoint | null {
	const { start, end } = resolveStartEnd(ctx.selection);
	if (!start || !end) return null;

	ctx.pushUndoSnapshot();
	const { collapsedCaret } = rangeDelete(ctx.getDoc(), start, end);
	ctx.selection.collapse();
	ctx.notifyDocMutated();
	return collapsedCaret;
}

function resolveStartEnd(selection: SelectionState): { start: SelectionPoint | null; end: SelectionPoint | null } {
	if (!selection.isCrossBlock) return { start: null, end: null };
	return { start: selection.start, end: selection.end };
}

// ── Internal ────────────────────────────────────────────────────────────────

/** Walk forward from `path` to the first leaf (non-container) block. */
function firstLeafAtOrAfter(doc: Document, path: number[]): number[] | null {
	let cur: number[] | null = path;
	while (cur) {
		const node = nodeAt(doc, cur);
		if (!node) return null;
		if (!('children' in node) || !node.children || node.children.length === 0) return cur;
		cur = [...cur, 0];
	}
	return null;
}

/** Walk backward from `path` into the deepest last descendant leaf. */
function lastLeafAtOrBefore(doc: Document, path: number[]): number[] | null {
	let cur: number[] | null = path;
	while (cur) {
		const node = nodeAt(doc, cur);
		if (!node) return null;
		if (!('children' in node) || !node.children || node.children.length === 0) return cur;
		cur = [...cur, node.children.length - 1];
	}
	return null;
}

/** Character offset at the end of the leaf node at `path`. 0 if missing. */
function leafOffsetEnd(doc: Document, path: number[]): number {
	const node = nodeAt(doc, path);
	if (!node || !('raw' in node) || typeof node.raw !== 'string') return 0;
	// raw includes a trailing newline (CST invariant); the cursor system
	// works in display space, so use displayLength to strip it.
	return displayLength(node.raw);
}

function pathsEqual(a: number[], b: number[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
