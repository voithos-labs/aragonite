// @vitest-environment jsdom
//
// Miss-analysis: the sticky-measure fixture held one text node, the one shape a collapsed range
// always measures, so nothing asked what the column reads or lands on in a block whose only
// content is a widget the caret can only sit beside.
//
// jsdom lays nothing out, so the rect methods are patched on the prototype: a collapsed range
// answers with no rect, the way a browser does beside a `contenteditable=false` widget, and a
// range around a node answers with the widget's box.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { asDomTextOffset, asEditorX } from '../../cursor/coordinate-spaces';
import { findOffsetNearestX, getCurrentCursorEditorRelativeX } from '../../cursor/sticky-measure';

const EDITOR_LEFT = 24;
const WIDGET = { left: 40, right: 64, top: 10, bottom: 30 };
// Text beside the widget on the same line: a shorter box sitting on the same baseline.
const TEXT = { left: 64, right: 72, top: 13, bottom: 30 };
const WIDGET_SOURCE_LENGTH = 5;

function box(rect: { left: number; right: number; top: number; bottom: number }): DOMRect {
	return {
		...rect,
		width: rect.right - rect.left,
		height: rect.bottom - rect.top,
		x: rect.left,
		y: rect.top,
		toJSON: () => ({})
	} as DOMRect;
}

const NO_RECTS = {
	length: 0,
	item: () => null,
	[Symbol.iterator]: function* () {}
} as unknown as DOMRectList;

function rectsOf(rect: DOMRect): DOMRectList {
	return {
		length: 1,
		item: (i: number) => (i === 0 ? rect : null),
		0: rect,
		[Symbol.iterator]: function* () {
			yield rect;
		}
	} as unknown as DOMRectList;
}

describe('a caret beside a widget, in a block whose only content is that widget', () => {
	let editor: HTMLElement;
	let block: HTMLElement;
	const originalRangeRects = Range.prototype.getClientRects;
	const originalRangeBox = Range.prototype.getBoundingClientRect;
	const originalElementBox = Element.prototype.getBoundingClientRect;

	beforeEach(() => {
		editor = document.createElement('div');
		editor.className = 'editor';
		block = document.createElement('div');
		block.contentEditable = 'true';
		const widget = document.createElement('span');
		widget.setAttribute('data-inline-widget', '');
		widget.setAttribute('data-source-start', '0');
		widget.setAttribute('data-source-end', String(WIDGET_SOURCE_LENGTH));
		widget.contentEditable = 'false';
		widget.appendChild(document.createTextNode('&'));
		block.appendChild(widget);
		editor.appendChild(block);
		document.body.appendChild(editor);

		// A range around a child answers with that child's box; a collapsed range inside text with
		// the text's; a collapsed range at an element-level position with nothing, as a browser does.
		Range.prototype.getClientRects = function (this: Range): DOMRectList {
			const child = childBoxOf(this);
			return child ? rectsOf(box(child)) : NO_RECTS;
		};
		Range.prototype.getBoundingClientRect = function (this: Range): DOMRect {
			return box(childBoxOf(this) ?? { left: 0, right: 0, top: 0, bottom: 0 });
		};
		Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
			const left = this === editor ? EDITOR_LEFT : 0;
			return box({ left, right: left, top: 0, bottom: 0 });
		};
	});

	afterEach(() => {
		Range.prototype.getClientRects = originalRangeRects;
		Range.prototype.getBoundingClientRect = originalRangeBox;
		Element.prototype.getBoundingClientRect = originalElementBox;
		editor.remove();
		window.getSelection()?.removeAllRanges();
	});

	function childBoxOf(range: Range): typeof WIDGET | null {
		if (range.startContainer.nodeType === Node.TEXT_NODE) {
			return range.startContainer.parentNode === block ? TEXT : null;
		}
		if (range.collapsed) return null;
		return range.startOffset === 0 ? WIDGET : TEXT;
	}

	function placeCaretAt(childIndex: number): void {
		const range = document.createRange();
		range.setStart(block, childIndex);
		range.collapse(true);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
	}

	it('reads its column off the widget edge it sits on, not the block edge', () => {
		placeCaretAt(1);
		expect(getCurrentCursorEditorRelativeX(block)).toBe(WIDGET.right - EDITOR_LEFT);
		placeCaretAt(0);
		expect(getCurrentCursorEditorRelativeX(block)).toBe(WIDGET.left - EDITOR_LEFT);
	});

	it('leaves the landing to text on the same line, which is where a caret shows', () => {
		block.appendChild(document.createTextNode('a'));
		// The column is the widget's own left edge, so without the rule the nearest candidate is
		// the widget's leading edge; the only position on the line that paints a caret is the text.
		const atWidgetEdge = asEditorX(WIDGET.left - EDITOR_LEFT);
		expect(findOffsetNearestX(block, atWidgetEdge, 'above', asDomTextOffset(0))).toBe(
			WIDGET_SOURCE_LENGTH
		);
	});

	it('lands on the widget edge nearest the column, from either direction', () => {
		const pastTheWidget = asEditorX(WIDGET.right + 20 - EDITOR_LEFT);
		const beforeTheWidget = asEditorX(WIDGET.left - 20 - EDITOR_LEFT);
		const zero = asDomTextOffset(0);
		expect(findOffsetNearestX(block, pastTheWidget, 'below', zero)).toBe(WIDGET_SOURCE_LENGTH);
		expect(findOffsetNearestX(block, pastTheWidget, 'above', zero)).toBe(WIDGET_SOURCE_LENGTH);
		expect(findOffsetNearestX(block, beforeTheWidget, 'below', zero)).toBe(0);
		expect(findOffsetNearestX(block, beforeTheWidget, 'above', zero)).toBe(0);
	});
});
