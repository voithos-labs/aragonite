// @vitest-environment jsdom
// Where a caret position sits against what the user sees, and whether the click ending a press
// moves it: the drawn caret paints nothing during a press it will.
// Miss-analysis: the dark-until-the-click rule asked only whether the press sat beside a widget, so
// a press inside a container's marker prefix (a task checkbox) painted its spot for every frame.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { caretIsInTextContent, clickMovesSeat } from '#lib/browser/text-seat.js';
import { buildAmbientSpan } from '#lib/components/blocks/marker-prefix.js';
import { placeCaretAt } from '../blocks/text/math-widget-fixture';

describe('caretIsInTextContent', () => {
	let el: HTMLElement;
	let textNode: Text;
	let widget: HTMLElement;

	beforeEach(() => {
		el = document.createElement('div');
		el.setAttribute('contenteditable', 'true');
		textNode = document.createTextNode('hello');
		widget = document.createElement('span');
		widget.setAttribute('contenteditable', 'false');
		widget.dataset.imageWidget = '';
		el.append(textNode, widget);
		document.body.appendChild(el);
	});

	afterEach(() => {
		el.remove();
		window.getSelection()?.removeAllRanges();
	});

	it('returns true when caret is inside a real text node within the editable', () => {
		placeCaretAt(textNode, 2);
		expect(caretIsInTextContent(el)).toBe(true);
	});

	it('returns false when caret is at element-level offset of the editable (no text node)', () => {
		placeCaretAt(el, 0);
		expect(caretIsInTextContent(el)).toBe(false);
	});

	it('returns false when caret is at element-level between two CE=false children', () => {
		textNode.remove();
		const widget2 = document.createElement('span');
		widget2.setAttribute('contenteditable', 'false');
		widget2.dataset.imageWidget = '';
		el.insertBefore(widget2, widget);
		placeCaretAt(el, 1);
		expect(caretIsInTextContent(el)).toBe(false);
	});

	// Miss-analysis: no row put the caret in a widget's own text, where Firefox's End leaves it.
	it('returns false when caret is in a widget’s own text', () => {
		widget.textContent = 'x2';
		placeCaretAt(widget.firstChild!, 1);
		widget.dataset.inlineWidget = '';
		expect(caretIsInTextContent(el)).toBe(false);
	});

	it('returns false when no selection is present', () => {
		window.getSelection()?.removeAllRanges();
		expect(caretIsInTextContent(el)).toBe(false);
	});

	it('returns false when caret is in a text node outside the editable', () => {
		const outside = document.createElement('p');
		const outsideText = document.createTextNode('outside');
		outside.appendChild(outsideText);
		document.body.appendChild(outside);
		try {
			placeCaretAt(outsideText, 1);
			expect(caretIsInTextContent(el)).toBe(false);
		} finally {
			outside.remove();
		}
	});
});

describe('clickMovesSeat', () => {
	let el: HTMLElement;
	let prefixText: Text;
	let text: Text;

	beforeEach(() => {
		el = document.createElement('div');
		el.setAttribute('contenteditable', 'true');
		const prefix = buildAmbientSpan('- [ ] ');
		prefixText = prefix.firstChild as Text;
		text = document.createTextNode('task one');
		const widget = document.createElement('span');
		widget.setAttribute('contenteditable', 'false');
		widget.dataset.imageWidget = '';
		el.append(prefix, text, widget);
		document.body.appendChild(el);
	});

	afterEach(() => el.remove());

	it('moves a seat inside the marker prefix, the task checkbox included', () => {
		expect(clickMovesSeat(el, { node: prefixText, offset: 3 })).toBe(true);
	});

	it('moves a seat beside a widget, at an element-level offset', () => {
		expect(clickMovesSeat(el, { node: el, offset: 2 })).toBe(true);
	});

	it('keeps a seat in the text, its first position right after the prefix included', () => {
		expect(clickMovesSeat(el, { node: text, offset: 0 })).toBe(false);
		expect(clickMovesSeat(el, { node: text, offset: 4 })).toBe(false);
	});
});
