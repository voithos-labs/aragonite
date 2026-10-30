// Which text a block's first- and last-line checks measure their edge line on, in jsdom: the
// caret's own line and the ranges starting in one text read line 0, every other range a line below.

import { isAtFirstVisualLine, isAtLastVisualLine } from '#lib/browser/visual-lines.js';

const LINE = 20;

function rectAt(top: number): DOMRect {
	return {
		left: 0,
		right: 5,
		top,
		bottom: top + LINE,
		width: 5,
		height: LINE,
		x: 0,
		y: top
	} as DOMRect;
}

/** Whether the `side` line check, with the caret in `edge`, finds `block`'s edge line on `edge`. */
export function edgeLineIsOn(block: HTMLElement, edge: Text, side: 'first' | 'last'): boolean {
	const rects = Range.prototype.getClientRects;
	const box = Range.prototype.getBoundingClientRect;
	// A collapsed range on an element is the block's contents fallback, measured off both lines.
	const top = (range: Range) =>
		range.collapsed
			? range.startContainer instanceof Text
				? 0
				: 4 * LINE
			: range.startContainer === edge
				? 0
				: 2 * LINE;
	Range.prototype.getClientRects = function (this: Range) {
		return [rectAt(top(this))] as unknown as DOMRectList;
	};
	Range.prototype.getBoundingClientRect = function (this: Range) {
		return rectAt(top(this));
	};
	try {
		window.getSelection()!.collapse(edge, side === 'first' ? 0 : edge.length);
		const bounds = { start: 0, end: block.textContent!.length };
		const lineRead = { focusEndsLine: () => null };
		// A fallback offset that answers false, so only the measure can answer true.
		return side === 'first'
			? isAtFirstVisualLine(block, bounds.end, bounds, lineRead)
			: isAtLastVisualLine(block, bounds.start, bounds, lineRead);
	} finally {
		Range.prototype.getClientRects = rects;
		Range.prototype.getBoundingClientRect = box;
		window.getSelection()!.removeAllRanges();
	}
}
