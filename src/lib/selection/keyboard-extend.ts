/** Keyboard extension and collapse: every end a key moves is written here, and shown. */

import type { SelectionState } from './selection-state.svelte';
import type { SelectedWidgetRange, SelectionPoint } from './primitives';
import type { Document } from '../core/nodes';
import { isVerticallyTransparentNode, type ArrivalReading } from '../core/inline/transparency';
import type { CaretLanding } from './caret-landing';
import {
	readNativeCaretInBlock,
	readDomPoint,
	applyCollapsedCaret,
	applySingleBlockRange
} from './native-bridge';
import { readNativeSelection } from '../browser/selection-read';
import type { CaretWriter } from '../browser/caret-writer';
import { pageTarget, type PageStepContext } from './page-step';
import { lineEdgeOffset } from '../browser/visual-lines';
import { offsetFromViewportPoint } from '../browser/point';
import { tableFocusExtension, type ArrowKey } from './table-rect-extend';
import { cellPoint } from './primitives';
import {
	firstPath,
	lastPath,
	firstCaretLeaf,
	lastCaretLeaf,
	nextCaretPath,
	previousCaretPath,
	findCellPathForElement
} from './path-lookup';
import { nodeAt } from '../tree-operations/node-primitives';
import { comparePaths, pathsEqual } from './path-math';
import { displayLength } from '../core/lines';

// ── Enter / Collapse ───────────────────────────────────────────────────────

/** Enters cross-block mode on a Shift+Arrow leaving a block, with the native caret as both
 *  anchor and focus; the caller extends the focus right after. */
function enterCrossBlockFromKeyboard(
	selection: SelectionState,
	writer: CaretWriter,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[]
): boolean {
	const anchorPoint = readNativeCaretInBlock(currentBlockEl, currentBlockPath);
	if (!anchorPoint) return false;
	selection.enterCrossBlock(anchorPoint, {
		path: anchorPoint.path.slice(),
		offset: anchorPoint.offset
	});
	// A collapsed caret stays in the focus block, or Chromium sends clipboard events to <body>;
	// an endpoint with no text position gets none, and `editor-root/clipboard.ts` covers it.
	applyCollapsedCaret(writer, currentBlockEl, anchorPoint);
	return true;
}

/** Collapses a cross-block range to its start or end and puts the caret back there as a stored
 *  byte, brought into view, mounting a windowed-out target and never opening a closed body. */
export async function collapseCrossBlock(
	selection: SelectionState,
	writer: CaretWriter,
	to: 'start' | 'end',
	doc: Document,
	restore: CaretLanding['restore']
): Promise<void> {
	const target = to === 'start' ? selection.start : selection.end;
	if (!target) return;
	selection.collapse();
	writer.clear();

	// A cell target takes the text-leaf caret path: the cell's own `focus` skips the collapse
	// steps, and a byte typed there would join the construct the cell opens with.
	const landing = selection.cellLandingFor(target);
	const point: SelectionPoint =
		to === 'end' && !pathsEqual(landing.path, target.path)
			? { path: landing.path, offset: leafOffsetEnd(doc, landing.path) }
			: landing;
	await restore({ anchor: point, focus: point }, { reveal: 'into-view' });
}

// ── Keyboard Extension ─────────────────────────────────────────────────────

/** What a keyboard extend reads and writes: the field names the keydown contexts already carry, so
 *  a context passes itself. */
export interface KeyboardExtendContext {
	selection: SelectionState;
	caretWriter: CaretWriter;
	getDoc(): Document;
	reading: ArrivalReading;
	/** Shows each end a key moves; a range folded back into one block goes down through `restore`. */
	caretLanding: Pick<CaretLanding, 'restore' | 'showSelectionEnd'>;
}

/** Every key that moves a cross-block focus moves it here, so the end it reaches is shown. A focus
 *  back on the anchor's block is a range inside it, restored with its direction. */
function moveFocusTo(ctx: KeyboardExtendContext, point: SelectionPoint): void {
	const { selection } = ctx;
	const anchor = selection.anchor;
	selection.extendFocus(point);
	if (selection.isCrossBlock || !anchor) {
		void ctx.caretLanding.showSelectionEnd();
		return;
	}
	void ctx.caretLanding.restore({ anchor, focus: point }, { reveal: 'into-view' });
}

/** Enters cross-block mode from the native caret unless a range is already live. */
function enterFromCaret(ctx: KeyboardExtendContext, el: HTMLElement, path: number[]): boolean {
	if (ctx.selection.isCrossBlock) return true;
	return enterCrossBlockFromKeyboard(ctx.selection, ctx.caretWriter, el, path);
}

/** Shift+Arrow over a live range moves its focus. A focus on a cell steps by row, or by cell inside
 *  a rectangle; any other walk starts from the leaf the focus sits in, a cell's own path. */
export function extendRangeByArrow(
	ctx: KeyboardExtendContext,
	el: HTMLElement,
	key: ArrowKey
): void {
	const { selection } = ctx;
	const focus = selection.focus;
	if (!focus) return;
	const ext = tableFocusExtension(ctx.getDoc(), selection.anchor, focus, key);
	if (ext?.kind === 'cell') {
		moveFocusTo(ctx, cellPoint(focus.path, ext.offset));
		return;
	}
	if (ext) {
		if (ext.direction === 'forward') extendFocusToNextBlock(ctx, el, ext.fromCellPath, 'vertical');
		else extendFocusToPreviousBlock(ctx, el, ext.fromCellPath, 'start');
		return;
	}
	const from = selection.cellLandingFor(focus).path;
	if (key === 'ArrowDown' || key === 'ArrowRight') {
		extendFocusToNextBlock(ctx, el, from, key === 'ArrowDown' ? 'vertical' : 'horizontal');
	} else {
		extendFocusToPreviousBlock(ctx, el, from, key === 'ArrowUp' ? 'start' : 'end');
	}
}

/** The first Shift+ArrowUp or Down at a cell's vertical edge: a range from that cell to the one a
 *  row away, or out of the table. False when the key reaches no cell and no block. */
export function extendFromCell(
	ctx: KeyboardExtendContext,
	el: HTMLElement,
	anchor: SelectionPoint,
	key: 'ArrowUp' | 'ArrowDown'
): boolean {
	const { selection } = ctx;
	const ext = tableFocusExtension(ctx.getDoc(), anchor, anchor, key);
	if (!ext) return false;
	// Recorded before the block-level extend answers, so a refusal (no block past the table) takes
	// it back: left behind, the next Backspace would delete a whole cell through it.
	selection.enterCrossBlock(anchor, anchor);
	if (ext.kind === 'cell') {
		moveFocusTo(ctx, cellPoint(anchor.path, ext.offset));
		return true;
	}
	const extended =
		ext.direction === 'forward'
			? extendFocusToNextBlock(ctx, el, ext.fromCellPath, 'vertical')
			: extendFocusToPreviousBlock(ctx, el, ext.fromCellPath, 'start');
	if (!extended) selection.collapse();
	return extended;
}

/** Shift+Home or Shift+End over a range across blocks: the focus goes to the edge of its visual line
 *  in `blockEl`, the block it sits in. A focus with no text line (a cell, a rule) stays. */
export function extendToLineEdge(
	ctx: KeyboardExtendContext,
	blockEl: HTMLElement,
	side: 'start' | 'end'
): void {
	const focus = ctx.selection.focus;
	if (!focus || focus.cellCoordinate) return;
	const offset = lineEdgeOffset(blockEl, focus.offset, side, ctx.caretWriter);
	if (offset !== null) moveFocusTo(ctx, { path: focus.path, offset });
}

/** What a page step reads on top of every extend's context. */
export type PageExtendContext = KeyboardExtendContext &
	PageStepContext & { caretLanding: Pick<CaretLanding, 'showSelectionEnd' | 'restore'> };

// Each step reads the end the step before it wrote, so a held key never steps twice from one place.
const pageSteps = new WeakMap<SelectionState, Promise<void>>();

/** Shift+PageUp or Shift+PageDown: the moving end goes a page up or down at its column, from a
 *  caret, a range inside the block `el` at `path`, or a range across blocks. */
export function extendByPage(
	ctx: PageExtendContext,
	el: HTMLElement,
	path: number[],
	direction: 'up' | 'down'
): Promise<void> {
	return queuePageStep(ctx, async (from) => {
		// Entered before the step's mounts, which can window out the block holding the anchor.
		if (!enterFromCaret(ctx, el, path)) return;
		moveFocusTo(ctx, (await pageTarget(ctx, from, direction)) ?? from);
	});
}

/** PageUp or PageDown with no Shift: the caret goes a page up or down at its column, and a range
 *  collapses to where its moving end would step. */
export function moveByPage(
	ctx: PageExtendContext,
	el: HTMLElement,
	path: number[],
	direction: 'up' | 'down'
): Promise<void> {
	return queuePageStep(ctx, async (from) => {
		const target = (await pageTarget(ctx, from, direction)) ?? from;
		// The landing forgets the caret memory, and with it the column the next page key aims at.
		const column = ctx.caretMemory.column();
		ctx.selection.collapse();
		ctx.caretWriter.clear();
		await ctx.caretLanding.restore({ anchor: target, focus: target }, { reveal: 'into-view' });
		if (column !== null) ctx.caretMemory.captureColumn(column);
	});
}

/** Runs `step` from the moving end once the step before it is done, the end shown first: a wheel
 *  may have taken it off screen, or out of the rendered window. */
function queuePageStep(
	ctx: PageExtendContext,
	step: (from: SelectionPoint) => Promise<void>
): Promise<void> {
	const run = async () => {
		await ctx.caretLanding.showSelectionEnd();
		const { selection } = ctx;
		const from = selection.isCrossBlock
			? selection.focus && selection.cellLandingFor(selection.focus)
			: nativeFocus(ctx);
		if (from) await step(from);
	};
	const queued = (pageSteps.get(ctx.selection) ?? Promise.resolve()).then(run);
	// A step that failed still lets the next one run; its caller hears the failure.
	pageSteps.set(
		ctx.selection,
		queued.catch(() => {})
	);
	return queued;
}

/** The browser selection's moving end, in whichever block the step before left it. */
function nativeFocus(ctx: PageStepContext): SelectionPoint | null {
	const live = readNativeSelection();
	const root = ctx.getEditorRoot();
	return live && root && readDomPoint(root, live.focus.node, live.focus.offset);
}

/** Moves the browser selection's focus inside `el` to raw `raw`, for a key the editor takes over
 *  inside one block, and shows it. */
export function extendWithinBlock(
	ctx: Pick<KeyboardExtendContext, 'caretWriter' | 'caretLanding'>,
	el: HTMLElement,
	raw: number
): void {
	if (ctx.caretWriter.extendSelectionToRaw(el, raw)) void ctx.caretLanding.showSelectionEnd();
}

/** Extends focus to the next leaf a caret can reach. The vertical axis skips leaves the caret
 *  passes over (an image-only paragraph); the horizontal stops on each, so it stays selectable. */
export function extendFocusToNextBlock(
	ctx: KeyboardExtendContext,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[],
	axis: 'horizontal' | 'vertical' = 'horizontal'
): boolean {
	const doc = ctx.getDoc();
	const leafTarget =
		axis === 'vertical'
			? firstNonTransparentLeafAfter(doc, ctx.reading, currentBlockPath)
			: nextCaretPath(doc, currentBlockPath);
	if (!leafTarget) return false;
	if (!enterFromCaret(ctx, currentBlockEl, currentBlockPath)) return false;
	moveFocusTo(ctx, { path: leafTarget, offset: 0 });
	return true;
}

/** Extends focus to the previous leaf: `'end'` crosses the boundary by one character, `'start'`
 *  takes the whole previous line as native ArrowUp does, skipping leaves the caret passes over. */
export function extendFocusToPreviousBlock(
	ctx: KeyboardExtendContext,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[],
	side: 'start' | 'end' = 'end'
): boolean {
	const doc = ctx.getDoc();
	const leafTarget =
		side === 'start'
			? lastNonTransparentLeafBefore(doc, ctx.reading, currentBlockPath)
			: previousCaretPath(doc, currentBlockPath);
	if (!leafTarget) return false;
	if (!enterFromCaret(ctx, currentBlockEl, currentBlockPath)) return false;
	const offset = side === 'start' ? 0 : leafOffsetEnd(doc, leafTarget);
	moveFocusTo(ctx, { path: leafTarget, offset });
	return true;
}

/** Extends focus to the document edge; a transparent edge leaf is bypassed for the nearest
 *  text-bearing one, as the one-step extension does. */
export function extendFocusToDocEdge(
	ctx: KeyboardExtendContext,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[],
	to: 'start' | 'end'
): boolean {
	const doc = ctx.getDoc();
	const reading = ctx.reading;
	const edge =
		to === 'start' ? firstCaretLeaf(doc, [0]) : lastCaretLeaf(doc, [doc.children.length - 1]);
	if (!edge) return false;

	const target = isTransparent(doc, reading, edge)
		? to === 'start'
			? firstNonTransparentLeafFrom(doc, reading, edge)
			: lastNonTransparentLeafFrom(doc, reading, edge)
		: edge;
	if (!target) return false;
	if (!enterFromCaret(ctx, currentBlockEl, currentBlockPath)) return false;

	const offset = to === 'end' ? leafOffsetEnd(doc, target) : 0;
	moveFocusTo(ctx, { path: target, offset });
	return true;
}

/** Selects the entire document as a cross-block range (the second Ctrl+A). */
export function selectWholeDocument(
	selection: SelectionState,
	writer: CaretWriter,
	doc: Document,
	getBlockElByPath?: (path: number[]) => HTMLElement | null
): boolean {
	// Not the caret-reachable order: the range has to cover a closed container's hidden body, so
	// that a delete or a copy of the whole document takes it too.
	const first = firstPath(doc);
	const last = lastPath(doc);
	if (!first || !last) return false;
	const lastOffset = leafOffsetEnd(doc, last);
	selection.enterCrossBlock({ path: first, offset: 0 }, { path: last, offset: lastOffset });

	// A one-block document has no cross-block range to paint and `enterCrossBlock` refuses it,
	// so select natively; otherwise a second Ctrl+A would deselect.
	if (!selection.isCustomRendered) {
		selection.collapse();
		const blockEl = getBlockElByPath?.(first);
		if (blockEl) {
			blockEl.focus({ preventScroll: true });
			applySingleBlockRange(writer, blockEl, 0, lastOffset);
		}
		return true;
	}

	// A collapsed caret for paste dispatch, as in `enterCrossBlockFromKeyboard`. A table focus
	// names the table block, whose wrapper holds no caret, so the caret goes in the cell.
	const focus = selection.focus;
	const parkPoint = focus && selection.cellLandingFor(focus);
	const focusBlockEl = parkPoint ? getBlockElByPath?.(parkPoint.path) : null;
	if (focusBlockEl && parkPoint) applyCollapsedCaret(writer, focusBlockEl, parkPoint);
	else writer.clear();
	return true;
}

// ── Shift+Click ────────────────────────────────────────────────────────────

/** Shift+click: extends the range, or grows one from a widget selected whole or the browser's caret,
 *  else `standInCaret`. False in the browser caret's own block, where its Shift+click makes it. */
export function handleShiftClick(
	selection: SelectionState,
	writer: CaretWriter,
	clickedBlockEl: HTMLElement,
	clickedBlockPath: number[],
	clickedX: number,
	clickedY: number,
	previouslyFocusedBlockEl: HTMLElement | null,
	previouslyFocusedBlockPath: number[] | null,
	standInCaret: SelectionPoint | null
): boolean {
	// While a widget is selected whole there is no caret to grow from, so the widget is the
	// anchor, its span read before the click ends that selection.
	const widget = selection.widgetRange();
	selection.clearWidget();
	const clickOffset = offsetFromViewportPoint(clickedBlockEl, clickedX, clickedY);
	if (clickOffset === null) return false;
	const focusPoint: SelectionPoint = { path: clickedBlockPath.slice(), offset: clickOffset };

	if (selection.isCrossBlock) {
		selection.extendFocus(focusPoint);
		return true;
	}

	if (widget) {
		const anchor = widgetShiftAnchor(widget, focusPoint);
		if (comparePaths(anchor.path, focusPoint.path) === 0) {
			applySingleBlockRange(writer, clickedBlockEl, anchor.offset, focusPoint.offset);
			return true;
		}
		enterRangeAtPress(selection, writer, clickedBlockEl, anchor, focusPoint);
		return true;
	}

	const nativeAnchor = previouslyFocusedBlockEl
		? readCaretOfBlock(previouslyFocusedBlockEl, previouslyFocusedBlockPath)
		: null;
	const anchor = nativeAnchor ?? standInCaret;
	if (!anchor) return false;

	if (comparePaths(anchor.path, focusPoint.path) === 0) {
		if (nativeAnchor) return false;
		applySingleBlockRange(writer, clickedBlockEl, anchor.offset, focusPoint.offset);
		return true;
	}

	enterRangeAtPress(selection, writer, clickedBlockEl, anchor, focusPoint);
	return true;
}

/** A range across blocks from `anchor` to a press, with a collapsed caret at the press for paste
 *  dispatch (see `enterCrossBlockFromKeyboard`) and focus on the pressed block. */
function enterRangeAtPress(
	selection: SelectionState,
	writer: CaretWriter,
	pressedBlockEl: HTMLElement,
	anchor: SelectionPoint,
	press: SelectionPoint
): void {
	selection.enterCrossBlock(anchor, press);
	applyCollapsedCaret(writer, pressedBlockEl, press);
	// The handled press cancels the browser's focus move, and reading mode declines the caret
	// that would otherwise carry focus there.
	pressedBlockEl.focus({ preventScroll: true });
}

/** The edge of a selected widget a shift-click grows from: the one away from the click, so the
 *  range covers the widget and everything up to the click. */
function widgetShiftAnchor(widget: SelectedWidgetRange, press: SelectionPoint): SelectionPoint {
	const order = comparePaths(press.path, widget.path);
	const pressAfter = order > 0 || (order === 0 && press.offset > widget.start);
	return { path: widget.path.slice(), offset: pressAfter ? widget.start : widget.end };
}

// ── Internal ───────────────────────────────────────────────────────────────

/** The browser's caret in `blockEl`, on its cell's path: a cell caret read on the table's path
 *  would look like a cell index to the endpoint snap. */
function readCaretOfBlock(blockEl: HTMLElement, path: number[] | null): SelectionPoint | null {
	const anchorPath = findCellPathForElement(blockEl) ?? path;
	return anchorPath && readNativeCaretInBlock(blockEl, anchorPath);
}

function isTransparent(doc: Document, reading: ArrivalReading, path: number[]): boolean {
	const node = nodeAt(doc, path);
	// nodeAt returns the Document for an empty path; narrow it out (Document has no `raw`).
	return node !== null && 'raw' in node && isVerticallyTransparentNode(node, reading);
}

function firstNonTransparentLeafAfter(
	doc: Document,
	reading: ArrivalReading,
	fromPath: number[]
): number[] | null {
	let leaf = nextCaretPath(doc, fromPath);
	while (leaf && isTransparent(doc, reading, leaf)) {
		leaf = nextCaretPath(doc, leaf);
	}
	return leaf;
}

function lastNonTransparentLeafBefore(
	doc: Document,
	reading: ArrivalReading,
	fromPath: number[]
): number[] | null {
	let leaf = previousCaretPath(doc, fromPath);
	while (leaf && isTransparent(doc, reading, leaf)) {
		leaf = previousCaretPath(doc, leaf);
	}
	return leaf;
}

/** Starts at the edge leaf itself and steps inward, unlike `nextCaretPath` and
 *  `previousCaretPath`, which step away from their start. */
function firstNonTransparentLeafFrom(
	doc: Document,
	reading: ArrivalReading,
	startPath: number[]
): number[] | null {
	if (!isTransparent(doc, reading, startPath)) return startPath;
	return firstNonTransparentLeafAfter(doc, reading, startPath);
}

function lastNonTransparentLeafFrom(
	doc: Document,
	reading: ArrivalReading,
	startPath: number[]
): number[] | null {
	if (!isTransparent(doc, reading, startPath)) return startPath;
	return lastNonTransparentLeafBefore(doc, reading, startPath);
}

function leafOffsetEnd(doc: Document, path: number[]): number {
	const node = nodeAt(doc, path);
	if (!node || !('raw' in node) || typeof node.raw !== 'string') return 0;
	// raw includes a trailing newline; the cursor works in display space.
	return displayLength(node.raw);
}
