/**
 * Cross-block keyboard extension and collapse. Pure helpers over
 * SelectionState.
 */

import type { SelectionState } from './selection-state.svelte';
import type { SelectionPoint } from './primitives';
import type { Document } from '../core/nodes';
import {
	readNativeCaretInBlock,
	applyCollapsedCaret,
	clearNativeSelection,
	offsetFromViewportPoint
} from './native-bridge';
import { nextPath, previousPath, firstPath, lastPath } from './path-lookup';
import { nodeAt } from '../tree-operations/node-ops';
import { comparePaths } from './primitives';
import { displayLength } from '../core/lines';

// ── Enter / Collapse / Scroll ──────────────────────────────────────────────

/**
 * Enter cross-block mode on a keyboard extension (Shift+Arrow leaving a
 * block). Captures the native caret as both anchor and focus; the caller
 * immediately extendFocus()es to the actual target.
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
	// Collapse (not clear) so the focus block retains a caret — otherwise
	// Chromium fires paste on <body>. See parkCaretInFocusBlock.
	applyCollapsedCaret(currentBlockEl, anchorPoint);
	return true;
}

/**
 * Collapse to start/end, restore a native caret, exit cross-block mode.
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
 * Scroll the focus block into view. No-op if already visible.
 */
export function scrollFocusBlockIntoView(
	selection: SelectionState,
	getBlockElByPath: (path: number[]) => HTMLElement | null
): void {
	if (!selection.focus) return;
	const blockEl = getBlockElByPath(selection.focus.path);
	blockEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ── Keyboard Extension ─────────────────────────────────────────────────────

/**
 * Extend focus to the next leaf in document order (Shift+ArrowDown /
 * Shift+ArrowRight leaving the current block). Enters cross-block mode if
 * still single-block. Returns true if focus moved.
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
 * Extend focus to the previous leaf (Shift+ArrowUp / Shift+ArrowLeft).
 * `side` = 'end' for ArrowLeft (cross boundary by one char), 'start' for
 * ArrowUp (select the whole previous line, matching native behavior).
 */
export function extendFocusToPreviousBlock(
	selection: SelectionState,
	doc: Document,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[],
	side: 'start' | 'end' = 'end'
): boolean {
	const target = previousPath(doc, currentBlockPath);
	if (!target) return false;
	const leafTarget = lastLeafAtOrBefore(doc, target);
	if (!leafTarget) return false;

	if (!selection.isCrossBlock) {
		if (!enterCrossBlockFromKeyboard(selection, currentBlockEl, currentBlockPath)) return false;
	}
	const offset = side === 'start' ? 0 : leafOffsetEnd(doc, leafTarget);
	selection.extendFocus({ path: leafTarget, offset });
	return true;
}

/**
 * Extend focus to the document edge (Ctrl+Shift+Home / Ctrl+Shift+End).
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
 * Select the entire document as a cross-block range (second Ctrl+A press).
 */
export function selectWholeDocument(
	selection: SelectionState,
	doc: Document,
	getBlockElByPath?: (path: number[]) => HTMLElement | null
): boolean {
	const first = firstPath(doc);
	const last = lastPath(doc);
	if (!first || !last) return false;
	const focusPoint = { path: last, offset: leafOffsetEnd(doc, last) };
	selection.enterCrossBlock({ path: first, offset: 0 }, focusPoint);
	// Paste-dispatch anchor, see enterCrossBlockFromKeyboard.
	const focusBlockEl = getBlockElByPath?.(last);
	if (focusBlockEl) applyCollapsedCaret(focusBlockEl, focusPoint);
	else clearNativeSelection();
	return true;
}

// ── Shift+Click ────────────────────────────────────────────────────────────

/**
 * Shift+click on a block. Extends the current cross-block selection or
 * enters cross-block mode using the previously focused block's caret as
 * the anchor. Returns false when no anchor could be recovered or the click
 * stayed within the same block (native shift-click handles that).
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

	// Same-block — native selection already produced a single-block range.
	if (comparePaths(anchor.path, focusPoint.path) === 0) return false;

	selection.enterCrossBlock(anchor, focusPoint);
	// Paste-dispatch anchor, see enterCrossBlockFromKeyboard. The click
	// default already plants one; being explicit avoids relying on that.
	applyCollapsedCaret(clickedBlockEl, focusPoint);
	return true;
}

// ── Internal ───────────────────────────────────────────────────────────────

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

function leafOffsetEnd(doc: Document, path: number[]): number {
	const node = nodeAt(doc, path);
	if (!node || !('raw' in node) || typeof node.raw !== 'string') return 0;
	// raw includes a trailing newline; the cursor works in display space.
	return displayLength(node.raw);
}
