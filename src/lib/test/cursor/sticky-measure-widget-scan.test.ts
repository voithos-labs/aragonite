// @vitest-environment jsdom
//
// Miss-analysis: the widget-edge fixture held one widget, so its whole walk was a handful of
// probes and nothing measured how far a vertical arrival scans a block made only of widgets.
//
// jsdom lays nothing out, so the rect methods are patched on the prototype: a collapsed range
// answers with no rect, as a browser does beside a `contenteditable=false` widget, and a range
// around a widget answers with that widget's box on a grid of lines.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { asDomTextOffset, asEditorX } from '../../cursor/coordinate-spaces';
import { findOffsetNearestX } from '../../cursor/sticky-measure';

const WIDGETS = 200;
const PER_LINE = 70;
const LINES = Math.ceil(WIDGETS / PER_LINE);
const WIDGET_WIDTH = 20;
const LINE_HEIGHT = 20;
const SOURCE_LENGTH = 5;
/** Every walk offset on one full line, a widget's edges and the offsets inside its source, and
 *  the next widget's, whose probe ends the walk. */
const ONE_LINE_OF_PROBES = (PER_LINE + 1) * SOURCE_LENGTH;

function widgetBox(index: number): DOMRect {
	const line = Math.floor(index / PER_LINE);
	const left = (index % PER_LINE) * WIDGET_WIDTH;
	const top = line * LINE_HEIGHT;
	return {
		left,
		right: left + WIDGET_WIDTH,
		top,
		bottom: top + LINE_HEIGHT,
		width: WIDGET_WIDTH,
		height: LINE_HEIGHT,
		x: left,
		y: top,
		toJSON: () => ({})
	} as DOMRect;
}

const ZERO = {
	...widgetBox(0),
	left: 0,
	right: 0,
	top: 0,
	bottom: 0,
	width: 0,
	height: 0
} as DOMRect;

/** A caret in the text after the second line of widgets: on the third line, a glyph apart. */
function textCaretBox(offset: number): DOMRect {
	const box = widgetBox(2 * PER_LINE);
	return { ...box, left: offset * 8, right: offset * 8, width: 0 } as DOMRect;
}

function rectList(rects: DOMRect[]): DOMRectList {
	return Object.assign([...rects], {
		item: (i: number) => rects[i] ?? null
	}) as unknown as DOMRectList;
}

describe('a vertical arrival into a paragraph made only of widgets', () => {
	let editor: HTMLElement;
	let block: HTMLElement;
	let probes = 0;
	const originalRangeRects = Range.prototype.getClientRects;
	const originalRangeBox = Range.prototype.getBoundingClientRect;
	const originalElementBox = Element.prototype.getBoundingClientRect;

	beforeEach(() => {
		editor = document.createElement('div');
		editor.className = 'editor';
		block = document.createElement('div');
		block.contentEditable = 'true';
		for (let i = 0; i < WIDGETS; i++) {
			const widget = document.createElement('span');
			widget.setAttribute('data-inline-widget', '');
			widget.setAttribute('data-source-start', String(i * SOURCE_LENGTH));
			widget.setAttribute('data-source-end', String((i + 1) * SOURCE_LENGTH));
			widget.contentEditable = 'false';
			widget.appendChild(document.createTextNode('&'));
			block.appendChild(widget);
		}
		editor.appendChild(block);
		document.body.appendChild(editor);
		probes = 0;

		// A collapsed range is one caret probe; a range around a widget measures its box.
		Range.prototype.getClientRects = function (this: Range): DOMRectList {
			if (this.collapsed) {
				probes++;
				const inText = this.startContainer.nodeType === Node.TEXT_NODE;
				return rectList(inText ? [textCaretBox(this.startOffset)] : []);
			}
			return rectList(this.startContainer === block ? [widgetBox(this.startOffset)] : []);
		};
		Range.prototype.getBoundingClientRect = function (this: Range): DOMRect {
			return this.collapsed || this.startContainer !== block ? ZERO : widgetBox(this.startOffset);
		};
		Element.prototype.getBoundingClientRect = () => ZERO;
	});

	afterEach(() => {
		Range.prototype.getClientRects = originalRangeRects;
		Range.prototype.getBoundingClientRect = originalRangeBox;
		Element.prototype.getBoundingClientRect = originalElementBox;
		editor.remove();
	});

	// The column sits on the fourth widget's right edge, which is the fourth widget's end offset.
	const column = asEditorX(4 * WIDGET_WIDTH);

	it('from above, probes the first line alone and lands on it', () => {
		const landed = findOffsetNearestX(block, column, 'above', asDomTextOffset(0));
		expect(landed).toBe(4 * SOURCE_LENGTH);
		expect(probes).toBeLessThanOrEqual(ONE_LINE_OF_PROBES);
	});

	it('from below, probes the last line alone and lands on it', () => {
		const landed = findOffsetNearestX(block, column, 'below', asDomTextOffset(0));
		expect(landed).toBe(((LINES - 1) * PER_LINE + 4) * SOURCE_LENGTH);
		expect(probes).toBeLessThanOrEqual(ONE_LINE_OF_PROBES);
	});

	// Two lines of widgets, then text: the text is the first line a caret shows on, and the bound
	// on a block of widgets alone must not stop the walk before it.
	it('in a block with text after its widget lines, still lands on the text', () => {
		while (block.childNodes.length > 2 * PER_LINE) block.lastChild!.remove();
		block.appendChild(document.createTextNode('abc'));
		const landed = findOffsetNearestX(block, asEditorX(16), 'above', asDomTextOffset(0));
		expect(landed).toBe(2 * PER_LINE * SOURCE_LENGTH + 2);
	});
});
