// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	caretIsInTextContent,
	isPlainTypingKey
} from '$lib/components/blocks/text/click-snap-guard';
import { placeCaretAt } from './math-widget-fixture';

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
		const sel = placeCaretAt(textNode, 2);
		expect(caretIsInTextContent(el, sel)).toBe(true);
	});

	it('returns false when caret is at element-level offset of the editable (no text node)', () => {
		const sel = placeCaretAt(el, 0);
		expect(caretIsInTextContent(el, sel)).toBe(false);
	});

	it('returns false when caret is at element-level between two CE=false children', () => {
		textNode.remove();
		const widget2 = document.createElement('span');
		widget2.setAttribute('contenteditable', 'false');
		widget2.dataset.imageWidget = '';
		el.insertBefore(widget2, widget);
		const sel = placeCaretAt(el, 1);
		expect(caretIsInTextContent(el, sel)).toBe(false);
	});

	it('returns false when no selection is present', () => {
		window.getSelection()?.removeAllRanges();
		expect(caretIsInTextContent(el, window.getSelection())).toBe(false);
	});

	it('returns false when selection is null', () => {
		expect(caretIsInTextContent(el, null)).toBe(false);
	});

	it('returns false when caret is in a text node outside the editable', () => {
		const outside = document.createElement('p');
		const outsideText = document.createTextNode('outside');
		outside.appendChild(outsideText);
		document.body.appendChild(outside);
		try {
			const sel = placeCaretAt(outsideText, 1);
			expect(caretIsInTextContent(el, sel)).toBe(false);
		} finally {
			outside.remove();
		}
	});
});

describe('isPlainTypingKey', () => {
	const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

	it('accepts a single printable character with no modifier', () => {
		for (const k of ['a', 'Z', '3', ' ', '$']) {
			expect(isPlainTypingKey(key({ key: k }))).toBe(true);
		}
	});

	it('accepts a shifted character — Shift is not a command modifier', () => {
		expect(isPlainTypingKey(key({ key: 'A', shiftKey: true }))).toBe(true);
	});

	it('rejects a single character held under ctrl/meta/alt (a command chord)', () => {
		expect(isPlainTypingKey(key({ key: 'a', ctrlKey: true }))).toBe(false);
		expect(isPlainTypingKey(key({ key: 'a', metaKey: true }))).toBe(false);
		expect(isPlainTypingKey(key({ key: 'a', altKey: true }))).toBe(false);
	});

	it('rejects multi-character named keys', () => {
		for (const k of ['Enter', 'ArrowLeft', 'Backspace', 'Delete', 'Tab', 'Escape']) {
			expect(isPlainTypingKey(key({ key: k }))).toBe(false);
		}
	});

	// An astral glyph is one typed character in two UTF-16 units (GH #122).
	it('accepts an astral-plane character', () => {
		expect(isPlainTypingKey(key({ key: '😀' }))).toBe(true);
		expect(isPlainTypingKey(key({ key: '𝓐' }))).toBe(true);
	});
});
