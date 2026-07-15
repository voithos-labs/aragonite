// @vitest-environment jsdom
//
// jsdom has no layout engine, so the browser rect primitives are patched at the
// prototype level (the SUT calls document.createRange() internally — per-range
// stubs never reach it). Each mocked rect is derived from the collapsed range's
// (startContainer, startOffset) so the SUT's real candidate scan, line-probe,
// and nearest-X selection run against the injected geometry. Only the browser
// primitives are stubbed; the SUT's own helpers (getOffsetRect,
// findDomTextOffsetTarget) run for real.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { asDomTextOffset, asEditorX } from '../../cursor/coordinate-spaces';
import {
	getCurrentCursorEditorRelativeX,
	getOffsetRect,
	findOffsetNearestX
} from '../../cursor/sticky-measure';

const CHAR_WIDTH = 8;
const LINE_HEIGHT = 18;
const EDITOR_LEFT = 30;

// Maps a character offset within a single text node to a fake rect. `wrapAt`
// pushes every offset >= wrapAt onto a second visual line whose top is two line
// heights below the first, so the two lines' band filters don't overlap.
function rectForOffset(offset: number, wrapAt: number): DOMRect {
	const onSecondLine = offset >= wrapAt;
	const top = onSecondLine ? LINE_HEIGHT * 4 : 0;
	const col = onSecondLine ? offset - wrapAt : offset;
	const left = col * CHAR_WIDTH;
	return {
		left,
		right: left + CHAR_WIDTH,
		top,
		bottom: top + LINE_HEIGHT,
		width: CHAR_WIDTH,
		height: LINE_HEIGHT,
		x: left,
		y: top,
		toJSON: () => ({})
	} as DOMRect;
}

describe('sticky-measure geometry', () => {
	let editor: HTMLElement;
	let block: HTMLElement;
	let text: Text;
	let wrapAt = Infinity;
	const originalRangeRects = Range.prototype.getClientRects;
	const originalRangeBox = Range.prototype.getBoundingClientRect;
	const originalElementBox = Element.prototype.getBoundingClientRect;

	function rectListFor(offset: number): DOMRectList {
		const rect = rectForOffset(offset, wrapAt);
		return {
			length: 1,
			item: (i: number) => (i === 0 ? rect : null),
			0: rect,
			[Symbol.iterator]: function* () {
				yield rect;
			}
		} as unknown as DOMRectList;
	}

	beforeEach(() => {
		editor = document.createElement('div');
		editor.className = 'editor';
		block = document.createElement('div');
		block.contentEditable = 'true';
		text = document.createTextNode('hello world');
		block.appendChild(text);
		editor.appendChild(block);
		document.body.appendChild(editor);

		Range.prototype.getClientRects = function (this: Range): DOMRectList {
			return rectListFor(this.startContainer === text ? this.startOffset : 0);
		};
		Range.prototype.getBoundingClientRect = function (this: Range): DOMRect {
			return rectForOffset(this.startContainer === text ? this.startOffset : 0, wrapAt);
		};
		Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
			const left = this === editor ? EDITOR_LEFT : 0;
			return {
				left,
				top: 0,
				right: 0,
				bottom: 0,
				width: 0,
				height: 0,
				x: left,
				y: 0,
				toJSON: () => ({})
			} as DOMRect;
		};
	});

	afterEach(() => {
		Range.prototype.getClientRects = originalRangeRects;
		Range.prototype.getBoundingClientRect = originalRangeBox;
		Element.prototype.getBoundingClientRect = originalElementBox;
		editor.remove();
		window.getSelection()?.removeAllRanges();
		wrapAt = Infinity;
	});

	function selectAt(node: Node, offset: number): void {
		const range = document.createRange();
		range.setStart(node, offset);
		range.collapse(true);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
	}

	describe('getCurrentCursorEditorRelativeX', () => {
		it('returns null when there is no selection range', () => {
			window.getSelection()?.removeAllRanges();
			expect(getCurrentCursorEditorRelativeX(block)).toBeNull();
		});

		it('subtracts the editor-container left from the viewport cursor X', () => {
			selectAt(text, 5);
			// cursor rect.left = 5 * CHAR_WIDTH = 40; editor left = 30 → editor-relative 10.
			expect(getCurrentCursorEditorRelativeX(block)).toBe(5 * CHAR_WIDTH - EDITOR_LEFT);
		});
	});

	describe('getOffsetRect', () => {
		it('returns null when the offset has no resolvable DOM position', () => {
			const empty = document.createElement('div');
			editor.appendChild(empty);
			expect(getOffsetRect(empty, asDomTextOffset(3))).toBeNull();
		});

		it('returns the measured rect at a resolvable offset', () => {
			const rect = getOffsetRect(block, asDomTextOffset(4));
			expect(rect).not.toBeNull();
			expect(rect!.left).toBe(4 * CHAR_WIDTH);
			expect(rect!.height).toBe(LINE_HEIGHT);
		});
	});

	describe('findOffsetNearestX', () => {
		it('returns minOffset when the container is shorter than minOffset', () => {
			expect(findOffsetNearestX(block, asEditorX(0), 'above', asDomTextOffset(999))).toBe(999);
		});

		it('returns minOffset when no offset yields a measurable rect', () => {
			const zeroRect = {
				left: 0,
				top: 0,
				right: 0,
				bottom: 0,
				width: 0,
				height: 0,
				x: 0,
				y: 0,
				toJSON: () => ({})
			} as DOMRect;
			Range.prototype.getClientRects = function (): DOMRectList {
				return {
					length: 0,
					item: () => null,
					[Symbol.iterator]: function* () {}
				} as unknown as DOMRectList;
			};
			Range.prototype.getBoundingClientRect = () => zeroRect;
			expect(findOffsetNearestX(block, asEditorX(50), 'above', asDomTextOffset(0))).toBe(0);
		});

		it('on a single line, lands on the offset whose X is nearest the target', () => {
			// Target X is editor-relative; SUT re-adds editor left internally.
			// editorRelativeX 50 → viewport 80 → nearest offset is 80/8 = 10.
			const offset = findOffsetNearestX(block, asEditorX(50), 'above', asDomTextOffset(0));
			expect(offset).toBe(10);
		});

		it('above vs below pick the matching X on different wrapped lines', () => {
			wrapAt = 6; // "hello " on line 1 (offsets 0-5), "world" on line 2 (offsets 6-11).
			// Target editor-relative X 10 → viewport 40 → column 5 on whichever line `from` probes.
			const above = findOffsetNearestX(block, asEditorX(10), 'above', asDomTextOffset(0));
			const below = findOffsetNearestX(block, asEditorX(10), 'below', asDomTextOffset(0));
			expect(above).toBe(5); // column 5 on line 1
			expect(below).toBe(11); // column 5 on line 2 = offset 6 + 5
			expect(above).not.toBe(below);
		});

		it('respects minOffset, excluding the prefix region from candidates', () => {
			// Target viewport X 0 would otherwise pick offset 0; minOffset 4 forbids it.
			const offset = findOffsetNearestX(
				block,
				asEditorX(-EDITOR_LEFT),
				'above',
				asDomTextOffset(4)
			);
			expect(offset).toBe(4);
		});

		it('bounds the scan to the probed edge instead of the whole block', () => {
			// 195-char text node, 20 chars/visual line → 10 lines, tops spaced wide so
			// the band filter never bridges adjacent lines (as the wrapped-line fixtures
			// above do). The bounded scan must read far fewer than all ~196 offsets.
			text.data = 'a'.repeat(195);
			const PER_LINE = 20;
			const LINE_GAP = LINE_HEIGHT * 3;
			let rectCalls = 0;
			const rectAt = (offset: number): DOMRect => {
				const top = Math.floor(offset / PER_LINE) * LINE_GAP;
				const left = (offset % PER_LINE) * CHAR_WIDTH;
				return {
					left,
					right: left + CHAR_WIDTH,
					top,
					bottom: top + LINE_HEIGHT,
					width: CHAR_WIDTH,
					height: LINE_HEIGHT,
					x: left,
					y: top,
					toJSON: () => ({})
				} as DOMRect;
			};
			Range.prototype.getClientRects = function (this: Range): DOMRectList {
				rectCalls++;
				const off = this.startContainer === text ? this.startOffset : 0;
				const rect = rectAt(off);
				return {
					length: 1,
					item: (i: number) => (i === 0 ? rect : null),
					0: rect,
					[Symbol.iterator]: function* () {
						yield rect;
					}
				} as unknown as DOMRectList;
			};

			// 'above' → first line (offsets 0-19); column 5 ⇒ offset 5.
			expect(
				findOffsetNearestX(
					block,
					asEditorX(5 * CHAR_WIDTH - EDITOR_LEFT),
					'above',
					asDomTextOffset(0)
				)
			).toBe(5);
			const aboveCalls = rectCalls;
			rectCalls = 0;
			// 'below' → last line (offsets 180-195); column 5 ⇒ offset 185.
			expect(
				findOffsetNearestX(
					block,
					asEditorX(5 * CHAR_WIDTH - EDITOR_LEFT),
					'below',
					asDomTextOffset(0)
				)
			).toBe(185);

			// Each direction reads only a few lines' worth of offsets, not all ~196.
			expect(aboveCalls).toBeLessThan(120);
			expect(rectCalls).toBeLessThan(120);
		});
	});
});
