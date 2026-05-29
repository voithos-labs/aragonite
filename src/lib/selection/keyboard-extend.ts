/**
 * Cross-block keyboard extension and collapse. Pure helpers over
 * SelectionState.
 */

import type { SelectionState } from './selection-state.svelte';
import type { SelectionPoint } from './primitives';
import type { Document, TableMetadata } from '../core/nodes';
import type { BlockComponentLookup } from '../editor-keys';
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
	doc: Document,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[]
): boolean {
	const anchorPoint = readNativeCaretInBlock(currentBlockEl, currentBlockPath);
	if (!anchorPoint) return false;
	const anchor = normalizeTableEndpoint(doc, anchorPoint.path, anchorPoint.offset);
	selection.enterCrossBlock(anchor, { path: anchor.path.slice(), offset: anchor.offset });
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
 *
 * `axis` = 'vertical' (Shift+ArrowDown) consults `getComponentByPath` to skip
 * vertically-transparent leaves — mirrors single-block focus dispatch. 'horizontal'
 * (Shift+ArrowRight) lands on the next leaf unconditionally so the user can
 * select an image-only paragraph in one step.
 */
export function extendFocusToNextBlock(
	selection: SelectionState,
	doc: Document,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[],
	axis: 'horizontal' | 'vertical' = 'horizontal',
	getComponentByPath?: BlockComponentLookup
): boolean {
	const leafTarget =
		axis === 'vertical'
			? firstNonTransparentLeafAfter(doc, currentBlockPath, getComponentByPath)
			: firstLeafAfter(doc, currentBlockPath);
	if (!leafTarget) return false;

	if (!selection.isCrossBlock) {
		if (!enterCrossBlockFromKeyboard(selection, doc, currentBlockEl, currentBlockPath))
			return false;
	}
	selection.extendFocus(normalizeTableEndpoint(doc, leafTarget, 0));
	return true;
}

/**
 * Extend focus to the previous leaf (Shift+ArrowUp / Shift+ArrowLeft).
 * `side` = 'end' for ArrowLeft (horizontal — cross boundary by one char),
 * 'start' for ArrowUp (vertical — select the whole previous line, matching
 * native behavior). The vertical path also skips vertically-transparent
 * leaves via `getComponentByPath` so parity with single-block dispatch holds.
 */
export function extendFocusToPreviousBlock(
	selection: SelectionState,
	doc: Document,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[],
	side: 'start' | 'end' = 'end',
	getComponentByPath?: BlockComponentLookup
): boolean {
	const leafTarget =
		side === 'start'
			? lastNonTransparentLeafBefore(doc, currentBlockPath, getComponentByPath)
			: lastLeafBefore(doc, currentBlockPath);
	if (!leafTarget) return false;

	if (!selection.isCrossBlock) {
		if (!enterCrossBlockFromKeyboard(selection, doc, currentBlockEl, currentBlockPath))
			return false;
	}
	const offset = side === 'start' ? 0 : leafOffsetEnd(doc, leafTarget);
	selection.extendFocus(normalizeTableEndpoint(doc, leafTarget, offset));
	return true;
}

/**
 * Extend focus to the document edge (Ctrl+Shift+Home / Ctrl+Shift+End).
 * Vertical-skip applies: a transparent edge leaf is bypassed in favor of
 * the nearest text-bearing leaf, matching the cross-block extension path.
 */
export function extendFocusToDocEdge(
	selection: SelectionState,
	doc: Document,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[],
	to: 'start' | 'end',
	getComponentByPath?: BlockComponentLookup
): boolean {
	const edge = to === 'start' ? firstPath(doc) : lastPath(doc);
	if (!edge) return false;

	const target = isTransparent(edge, getComponentByPath)
		? to === 'start'
			? firstNonTransparentLeafFrom(doc, edge, getComponentByPath)
			: lastNonTransparentLeafFrom(doc, edge, getComponentByPath)
		: edge;
	if (!target) return false;

	if (!selection.isCrossBlock) {
		if (!enterCrossBlockFromKeyboard(selection, doc, currentBlockEl, currentBlockPath))
			return false;
	}

	const offset = to === 'end' ? leafOffsetEnd(doc, target) : 0;
	selection.extendFocus(normalizeTableEndpoint(doc, target, offset));
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

/** First leaf reachable from `fromPath` going forward (descend or step). */
function firstLeafAfter(doc: Document, fromPath: number[]): number[] | null {
	const next = nextPath(doc, fromPath);
	return next ? firstLeafAtOrAfter(doc, next) : null;
}

/** Last leaf reachable from `fromPath` going backward (descend or step). */
function lastLeafBefore(doc: Document, fromPath: number[]): number[] | null {
	const prev = previousPath(doc, fromPath);
	return prev ? lastLeafAtOrBefore(doc, prev) : null;
}

function isTransparent(
	path: number[],
	getComponentByPath: BlockComponentLookup | undefined
): boolean {
	return getComponentByPath?.(path)?.isVerticallyTransparent?.() ?? false;
}

/**
 * Walk forward from `fromPath` to the next leaf whose component is not
 * vertically transparent. Without `getComponentByPath` the predicate
 * collapses to the plain "next leaf" walker.
 */
function firstNonTransparentLeafAfter(
	doc: Document,
	fromPath: number[],
	getComponentByPath: BlockComponentLookup | undefined
): number[] | null {
	let leaf = firstLeafAfter(doc, fromPath);
	while (leaf && isTransparent(leaf, getComponentByPath)) {
		leaf = firstLeafAfter(doc, leaf);
	}
	return leaf;
}

function lastNonTransparentLeafBefore(
	doc: Document,
	fromPath: number[],
	getComponentByPath: BlockComponentLookup | undefined
): number[] | null {
	let leaf = lastLeafBefore(doc, fromPath);
	while (leaf && isTransparent(leaf, getComponentByPath)) {
		leaf = lastLeafBefore(doc, leaf);
	}
	return leaf;
}

/**
 * Doc-edge resolver: starting AT the edge leaf (which is itself transparent),
 * step inward until a text-bearing leaf is found. Distinct from the
 * "first/lastLeafAfter/Before" walkers because those step away from `fromPath`.
 */
function firstNonTransparentLeafFrom(
	doc: Document,
	startPath: number[],
	getComponentByPath: BlockComponentLookup | undefined
): number[] | null {
	if (!isTransparent(startPath, getComponentByPath)) return startPath;
	return firstNonTransparentLeafAfter(doc, startPath, getComponentByPath);
}

function lastNonTransparentLeafFrom(
	doc: Document,
	startPath: number[],
	getComponentByPath: BlockComponentLookup | undefined
): number[] | null {
	if (!isTransparent(startPath, getComponentByPath)) return startPath;
	return lastNonTransparentLeafBefore(doc, startPath, getComponentByPath);
}

function leafOffsetEnd(doc: Document, path: number[]): number {
	const node = nodeAt(doc, path);
	if (!node || !('raw' in node) || typeof node.raw !== 'string') return 0;
	// raw includes a trailing newline; the cursor works in display space.
	return displayLength(node.raw);
}

/**
 * A cross-block selection endpoint inside a table must address the table block
 * by row-major cell index (`[tableIdx]` + cellIdx), matching the pointer-drag
 * representation. A deep `[tableIdx, row, col]` leaf path with a character
 * offset routes the delete through the generic (non-table-aware) path, which
 * merges external text into a cell and corrupts the grid. Non-table paths pass
 * through unchanged.
 */
function normalizeTableEndpoint(doc: Document, path: number[], offset: number): SelectionPoint {
	for (let d = 0; d < path.length - 1; d++) {
		const node = nodeAt(doc, path.slice(0, d + 1));
		if (node && 'kind' in node && node.kind === 'table') {
			const colCount = (node.metadata as TableMetadata).columnCount;
			const rowIdx = path[d + 1];
			const colIdx = path[d + 2] ?? 0;
			return { path: path.slice(0, d + 1), offset: rowIdx * colCount + colIdx };
		}
	}
	return { path: path.slice(), offset };
}
