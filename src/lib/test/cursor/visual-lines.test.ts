// @vitest-environment jsdom
// The line-position predicates need rect measurement, which jsdom zeroes out, so the browser rect
// primitives are patched at the prototype level (the SUT calls document.createRange() internally —
// per-range stubs never reach it). Each mocked rect derives from the range's (startContainer,
// startOffset), so the SUT's real text-node walk and line-delta comparison run against it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	getRangeTop,
	getCharRangeTop,
	findFirstTextNode,
	findLastTextNode,
	isAtFirstVisualLine,
	isAtLastVisualLine
} from '../../cursor/visual-lines';

describe('findFirstTextNode / findLastTextNode', () => {
	it('returns the node itself when it is a non-empty text node', () => {
		const text = document.createTextNode('hi');
		expect(findFirstTextNode(text)).toBe(text);
		expect(findLastTextNode(text)).toBe(text);
	});

	it('returns null for an empty container', () => {
		const el = document.createElement('div');
		expect(findFirstTextNode(el)).toBeNull();
		expect(findLastTextNode(el)).toBeNull();
	});

	it('skips empty text nodes', () => {
		const el = document.createElement('div');
		el.appendChild(document.createTextNode(''));
		const real = document.createTextNode('x');
		el.appendChild(real);
		expect(findFirstTextNode(el)).toBe(real);
		expect(findLastTextNode(el)).toBe(real);
	});

	it('descends into nested elements and respects document order', () => {
		const el = document.createElement('div');
		el.innerHTML = '<span>a</span>mid<b><i>z</i></b>';
		const first = findFirstTextNode(el);
		const last = findLastTextNode(el);
		expect(first?.textContent).toBe('a');
		expect(last?.textContent).toBe('z');
	});

	it('finds the descendant text node when children are element-only', () => {
		const el = document.createElement('div');
		el.innerHTML = '<span><b>deep</b></span>';
		expect(findFirstTextNode(el)?.textContent).toBe('deep');
		expect(findLastTextNode(el)?.textContent).toBe('deep');
	});

	it('returns null when only empty text and marker elements are present', () => {
		const el = document.createElement('div');
		el.innerHTML = '<span class="md-marker"></span>';
		expect(findFirstTextNode(el)).toBeNull();
		expect(findLastTextNode(el)).toBeNull();
	});
});

const LINE_HEIGHT = 20;

function rectAt(top: number, height = LINE_HEIGHT): DOMRect {
	return {
		left: 0,
		right: 5,
		top,
		bottom: top + height,
		width: 5,
		height,
		x: 0,
		y: top,
		toJSON: () => ({})
	} as DOMRect;
}

function rectListOf(rect: DOMRect | null): DOMRectList {
	if (!rect) {
		return {
			length: 0,
			item: () => null,
			[Symbol.iterator]: function* () {}
		} as unknown as DOMRectList;
	}
	return {
		length: 1,
		item: (i: number) => (i === 0 ? rect : null),
		0: rect,
		[Symbol.iterator]: function* () {
			yield rect;
		}
	} as unknown as DOMRectList;
}

describe('getRangeTop', () => {
	const originalRects = Range.prototype.getClientRects;
	const originalBox = Range.prototype.getBoundingClientRect;
	afterEach(() => {
		Range.prototype.getClientRects = originalRects;
		Range.prototype.getBoundingClientRect = originalBox;
	});

	it('returns null when there are no positive-height rects', () => {
		Range.prototype.getClientRects = () => rectListOf(null);
		Range.prototype.getBoundingClientRect = () => rectAt(0, 0);
		const range = document.createRange();
		expect(getRangeTop(range)).toBeNull();
	});

	it('returns the top of the first positive-height client rect', () => {
		Range.prototype.getClientRects = () => rectListOf(rectAt(42));
		const range = document.createRange();
		expect(getRangeTop(range)).toBe(42);
	});
});

describe('getCharRangeTop', () => {
	let text: Text;
	const original = Range.prototype.getClientRects;

	beforeEach(() => {
		text = document.createTextNode('abcdef');
		document.body.appendChild(text);
	});

	afterEach(() => {
		Range.prototype.getClientRects = original;
		text.remove();
	});

	it('returns null for an out-of-bounds offset', () => {
		Range.prototype.getClientRects = () => rectListOf(rectAt(10));
		expect(getCharRangeTop(text, 999, false)).toBeNull();
	});

	it('measures the char range top for a forward (not-at-end) range', () => {
		Range.prototype.getClientRects = function (this: Range) {
			return rectListOf(rectAt(this.startContainer === text ? 17 : 0));
		} as typeof Range.prototype.getClientRects;
		expect(getCharRangeTop(text, 0, false)).toBe(17);
	});

	it('measures the char range top for an at-end range', () => {
		Range.prototype.getClientRects = () => rectListOf(rectAt(33));
		expect(getCharRangeTop(text, 6, true)).toBe(33);
	});
});

describe('isAtFirstVisualLine / isAtLastVisualLine', () => {
	let block: HTMLElement;
	let text: Text;
	let cursorTop = 0;
	const originalRangeRects = Range.prototype.getClientRects;
	const originalRangeBox = Range.prototype.getBoundingClientRect;
	const originalComputed = window.getComputedStyle;

	beforeEach(() => {
		block = document.createElement('div');
		block.contentEditable = 'true';
		text = document.createTextNode('hello world');
		block.appendChild(text);
		document.body.appendChild(block);

		// The selection's collapsed range reads cursorTop; char-probe ranges built
		// inside the SUT around the first/last text node anchor the boundary lines.
		Range.prototype.getClientRects = function (this: Range): DOMRectList {
			if (this.collapsed) return rectListOf(rectAt(cursorTop));
			const probeTop = this.startContainer === text && this.startOffset === 0 ? 0 : 40;
			return rectListOf(rectAt(probeTop));
		};
		Range.prototype.getBoundingClientRect = function (this: Range): DOMRect {
			return rectAt(this.collapsed ? cursorTop : 0);
		};
		window.getComputedStyle = (() => ({
			lineHeight: `${LINE_HEIGHT}px`
		})) as unknown as typeof window.getComputedStyle;
	});

	afterEach(() => {
		Range.prototype.getClientRects = originalRangeRects;
		Range.prototype.getBoundingClientRect = originalRangeBox;
		window.getComputedStyle = originalComputed;
		block.remove();
		window.getSelection()?.removeAllRanges();
	});

	function placeCursor(offset: number): void {
		const range = document.createRange();
		range.setStart(text, offset);
		range.collapse(true);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
	}

	it('resolves via the fallback offset when the selection range is dropped', () => {
		// Chromium drops the caret range adjacent to atomic contenteditable=false islands under load,
		// and a hard-false there strands the caret forever; trust the snapped fallback offset instead.
		window.getSelection()?.removeAllRanges();
		expect(isAtFirstVisualLine(block, 0, 0)).toBe(true);
		expect(isAtFirstVisualLine(block, 5, 0)).toBe(false);
		expect(isAtLastVisualLine(block, 11, 11)).toBe(true);
		expect(isAtLastVisualLine(block, 5, 11)).toBe(false);
	});

	it('returns true for an empty container regardless of geometry', () => {
		const empty = document.createElement('div');
		empty.contentEditable = 'true';
		document.body.appendChild(empty);
		const range = document.createRange();
		range.selectNodeContents(empty);
		range.collapse(true);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
		expect(isAtFirstVisualLine(empty, 0, 0)).toBe(true);
		expect(isAtLastVisualLine(empty, 0, 0)).toBe(true);
		empty.remove();
	});

	it('isAtFirstVisualLine: true on the first line, false once the cursor drops a line', () => {
		placeCursor(2);
		cursorTop = 0; // same line as the first-text-node probe (top 0)
		expect(isAtFirstVisualLine(block, 2, 0)).toBe(true);
		cursorTop = 40; // a full line below the first line
		expect(isAtFirstVisualLine(block, 2, 0)).toBe(false);
	});

	it('isAtLastVisualLine: true on the last line, false when the cursor sits a line above it', () => {
		placeCursor(8);
		cursorTop = 40; // same line as the last-text-node probe (top 40)
		expect(isAtLastVisualLine(block, 8, 11)).toBe(true);
		cursorTop = 0; // a full line above the last line
		expect(isAtLastVisualLine(block, 8, 11)).toBe(false);
	});

	it('isAtFirstVisualLine: falls back to the landable start when the rect is unmeasurable', () => {
		placeCursor(0);
		Range.prototype.getClientRects = function (this: Range): DOMRectList {
			return this.collapsed ? rectListOf(null) : rectListOf(rectAt(0));
		};
		Range.prototype.getBoundingClientRect = function (this: Range): DOMRect {
			return this.collapsed ? rectAt(0, 0) : rectAt(0);
		};
		expect(isAtFirstVisualLine(block, 0, 0)).toBe(true);
		expect(isAtFirstVisualLine(block, 5, 0)).toBe(false);
		// A leading hidden run puts the block's first landable offset past raw 0, and the
		// fallback answers for the caret the user can actually produce there.
		expect(isAtFirstVisualLine(block, 3, 3)).toBe(true);
	});

	it('isAtLastVisualLine: falls back to the landable end when the rect is unmeasurable', () => {
		placeCursor(11);
		Range.prototype.getClientRects = function (this: Range): DOMRectList {
			return this.collapsed ? rectListOf(null) : rectListOf(rectAt(40));
		};
		Range.prototype.getBoundingClientRect = function (this: Range): DOMRect {
			return this.collapsed ? rectAt(0, 0) : rectAt(40);
		};
		expect(isAtLastVisualLine(block, 11, 11)).toBe(true);
		expect(isAtLastVisualLine(block, 5, 11)).toBe(false);
		// The mirror of the first-line case: a trailing hidden run moves the bound in.
		expect(isAtLastVisualLine(block, 8, 8)).toBe(true);
	});
});
