/**
 * What the drawn caret's paint reads off the layout: the caret's box, the block host the bar draws
 * in, the bar's box beside an inline widget, and the places where the range's box isn't where the
 * browser paints its own caret (beside a widget, at a soft wrap, clipped by an inner scroller, at a
 * code chip's edge). Reads only; the target decides what to draw from these.
 */

import {
	caretRectAt,
	nearestLetter,
	neighbourCaretRect,
	softWrapAt,
	type CaretRect
} from '../browser/visual-lines';
import { isAtomicInlineWidget } from '../browser/painted';
import { FRAME_ATTR } from '../core/inline/widget-shell';
import { widgetElByStart } from '../core/inline/inline-widgets';
import type { ClientCaretBox, HostBox, WidgetEdgeBox } from './drawn-caret-target';

export interface CaretMeasure {
	host: HTMLElement;
	hostBox: HostBox;
	caret: CaretRect | null;
	/** The caret sits beside an inline widget, where the range has no box of its own. */
	besideWidget: boolean;
	/** The caret sits in the run of spaces a line wraps in. */
	atSoftWrap: boolean;
	/** A scroller between the editable and its host clips the caret's box out of view. */
	clipped: boolean;
	/** The code chip whose edge the caret sits at, where each engine paints on its own side of the
	 *  chip's padding, so the bar draws against the chip's box instead. */
	chipEdge: ChipEdge | null;
}

/** A code chip, and which of its edges. */
export interface ChipEdge {
	chip: HTMLElement;
	at: 'opener' | 'closer';
}

/** The element the bar draws in for a caret in `surface`: its block host. */
export function caretHost(surface: HTMLElement): HTMLElement | null {
	return surface.closest<HTMLElement>('[data-block-path]') ?? surface.parentElement;
}

/** Where the bar's position is measured from inside `host`: its padding box, past any scroll. */
export function hostBox(host: HTMLElement): HostBox {
	const box = host.getBoundingClientRect();
	const scale = host.offsetWidth > 0 ? box.width / host.offsetWidth : 1;
	return {
		left: box.left + (host.clientLeft - host.scrollLeft) * scale,
		top: box.top + (host.clientTop - host.scrollTop) * scale,
		scale
	};
}

/** The bar on one side of `widget` in `surface`: at a picture's edge, the height of the text on its
 *  line, where the next letter lands; beside any other widget, 1px clear and the widget's height. */
export function widgetEdgeBox(
	widget: HTMLElement,
	side: 'before' | 'after',
	surface: HTMLElement
): WidgetEdgeBox {
	const r = widget.getBoundingClientRect();
	if (widget.hasAttribute(FRAME_ATTR)) {
		const line = lineTextBox(widget, r, surface) ?? r;
		const left = side === 'after' ? r.right : r.left;
		return { left, top: line.top, bottom: line.bottom, width: WIDGET_BAR_WIDTH };
	}
	return {
		left: side === 'after' ? r.right + 1 - WIDGET_BAR_WIDTH : r.left - 1,
		top: r.top,
		bottom: r.bottom,
		width: WIDGET_BAR_WIDTH
	};
}

/** The bar beside the widget whose source ends (else starts) at raw `offset` in `surface`, the
 *  edge a click held; null when no widget sits there. */
export function widgetEdgeAt(surface: HTMLElement, offset: number): WidgetEdgeBox | null {
	const ending = surface.querySelector<HTMLElement>(
		`[data-inline-widget][data-source-end="${offset}"]`
	);
	if (ending) return widgetEdgeBox(ending, 'after', surface);
	const starting = widgetElByStart(surface, offset);
	return starting && widgetEdgeBox(starting, 'before', surface);
}

export function measureCaret(surface: HTMLElement, range: Range): CaretMeasure | null {
	const host = caretHost(surface);
	if (!host) return null;
	const own = caretRectAt(surface, range.startContainer, range.startOffset);
	const caret = own ?? neighbourCaretRect(range);
	return {
		host,
		hostBox: hostBox(host),
		caret: caret && { left: caret.left, top: caret.top, bottom: caret.bottom },
		besideWidget: own === null && touchesWidget(range),
		atSoftWrap: own !== null && softWrapAt(range, surface) !== null,
		clipped: caret !== null && clippedBetween(surface, host, caret),
		chipEdge: codeChipEdge(range, surface)
	};
}

/** The bar at one of a chip's two stops: inside, at its first or last letter in the padding;
 *  outside, 2px past its border. The opener reads the chip's first line box, the closer its last. */
export function chipStopBox(edge: ChipEdge, side: 'inside' | 'outside'): ClientCaretBox | null {
	const boxes = edge.chip.getClientRects();
	const text = document.createRange();
	text.selectNodeContents(edge.chip);
	const glyphs = [...text.getClientRects()].filter((r) => r.width > 0);
	if (boxes.length === 0 || glyphs.length === 0) return null;
	const closer = edge.at === 'closer';
	const box = boxes[closer ? boxes.length - 1 : 0];
	const glyph = glyphs[closer ? glyphs.length - 1 : 0];
	const inside = closer ? glyph.right : glyph.left;
	const outside = closer ? box.right + CHIP_STOP_GAP : box.left - CHIP_STOP_GAP;
	return { left: side === 'inside' ? inside : outside, top: glyph.top, bottom: glyph.bottom };
}

// ── Internal ────────────────────────────────────────────────────────────────

const WIDGET_BAR_WIDTH = 1.5;

/** A code span's painted chip. */
export const CODE_CHIP = '.inline-code-content';

/** How far past a chip's border its outside stop draws. */
const CHIP_STOP_GAP = 2;

// The caret at a code chip's first or last letter, or in the text just outside the chip.
export function codeChipEdge(range: Range, surface: HTMLElement): ChipEdge | null {
	const node = range.startContainer;
	if (!(node instanceof Text)) return null;
	const at = range.startOffset;
	const own = node.parentElement?.closest<HTMLElement>(CODE_CHIP);
	if (own) {
		if (at === 0) return { chip: own, at: 'opener' };
		return at === node.data.length ? { chip: own, at: 'closer' } : null;
	}
	const before = at === 0 ? nearestLetter(node, 0, surface, false) : null;
	const after = at === node.data.length ? nearestLetter(node, at, surface, true) : null;
	const closing = before?.node.parentElement?.closest<HTMLElement>(CODE_CHIP);
	if (closing) return { chip: closing, at: 'closer' };
	const opening = after?.node.parentElement?.closest<HTMLElement>(CODE_CHIP);
	return opening ? { chip: opening, at: 'opener' } : null;
}

// A scroller inside the block (a code block's long lines, a wide cell) clips the browser's caret,
// but not the bar, which sits outside it in the host.
function clippedBetween(surface: HTMLElement, host: HTMLElement, caret: CaretRect): boolean {
	for (let el: HTMLElement | null = surface; el && el !== host; el = el.parentElement) {
		if (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) continue;
		const style = getComputedStyle(el);
		if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
		const box = el.getBoundingClientRect();
		const scale = el.offsetWidth > 0 ? box.width / el.offsetWidth : 1;
		const left = box.left + el.clientLeft * scale;
		const top = box.top + el.clientTop * scale;
		const outside =
			caret.left < left - 1 ||
			caret.left > left + el.clientWidth * scale + 1 ||
			caret.bottom < top ||
			caret.top > top + el.clientHeight * scale;
		if (outside) return true;
	}
	return false;
}

/** The text-height box on a picture's line: the first text or caret anchor after it, else the
 *  last text before it, that shares the picture's line. */
function lineTextBox(frame: HTMLElement, r: DOMRect, surface: HTMLElement): CaretRect | null {
	const onLine = (box: CaretRect | null) => box && box.bottom > r.top && box.top < r.bottom;
	for (const side of ['after', 'before'] as const) {
		const box = nearestLineBox(frame, side, surface);
		if (onLine(box)) return box;
	}
	return null;
}

// Past hidden marker runs, which measure to nothing, and past other widgets.
function nearestLineBox(
	from: Node,
	side: 'before' | 'after',
	surface: HTMLElement
): CaretRect | null {
	for (let node = stepPast(from, side, surface); node; node = stepPast(node, side, surface)) {
		if (node instanceof Text && node.data !== '') {
			const box = caretRectAt(surface, node, side === 'after' ? 0 : node.data.length);
			if (box) return box;
		} else if (node instanceof HTMLBRElement && node.parentNode) {
			const at = Array.prototype.indexOf.call(node.parentNode.childNodes, node);
			const box = neighbourCaretRect({ startContainer: node.parentNode, startOffset: at });
			if (box) return box;
		}
	}
	return null;
}

/** The next node on `side` in document order, entering elements but never a widget. */
function stepPast(node: Node, side: 'before' | 'after', root: Node): Node | null {
	const child = side === 'after' ? node.firstChild : node.lastChild;
	if (child && node !== root && !isAtomicInlineWidget(node)) return child;
	for (let at: Node | null = node; at && at !== root; at = at.parentNode) {
		const sibling = side === 'after' ? at.nextSibling : at.previousSibling;
		if (sibling) return sibling;
	}
	return null;
}

function touchesWidget(range: Range): boolean {
	const kids = range.startContainer.childNodes;
	const at = range.startOffset;
	return [kids[at], kids[at - 1]].some((node) => node !== undefined && isAtomicInlineWidget(node));
}
