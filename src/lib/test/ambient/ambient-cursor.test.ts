// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAmbientCursorIO } from '../../ambient/ambient-cursor';
import { asRawOffset } from '../../cursor/coordinate-spaces';

// Fixture: a list-item prose surface — marker span "- " (walk [0,2)) then the
// block's own raw text "hello" (walk [2,7), raw [0,5)).
const AMBIENT = '- ';
let el: HTMLElement;
let marker: HTMLElement;
let text: Text;
let elsewhere: HTMLElement;

function mount(): void {
	el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	// jsdom only moves document.activeElement for a focusable element.
	el.tabIndex = 0;
	marker = document.createElement('span');
	marker.className = 'md-marker';
	marker.setAttribute('contenteditable', 'false');
	marker.textContent = AMBIENT;
	text = document.createTextNode('hello');
	el.append(marker, text);

	elsewhere = document.createElement('div');
	elsewhere.tabIndex = 0;
	elsewhere.append(document.createTextNode('xyz'));

	document.body.append(el, elsewhere);
}

function cursorIO(snapTarget: number | null = null) {
	return createAmbientCursorIO({
		getEl: () => el,
		getAmbientLength: () => AMBIENT.length,
		getSnapTarget: () => snapTarget
	});
}

function select(startNode: Node, startOffset: number, endNode: Node, endOffset: number): void {
	const range = document.createRange();
	range.setStart(startNode, startOffset);
	range.setEnd(endNode, endOffset);
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(range);
}

beforeEach(() => {
	mount();
	window.getSelection()?.removeAllRanges();
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('getRawSelection', () => {
	it('reads a selection inside the focused surface in raw offsets', () => {
		el.focus();
		select(text, 1, text, 3);
		expect(cursorIO().getRawSelection()).toEqual({ start: 1, end: 3 });
	});

	it('reports no selection when the surface does not hold focus', () => {
		// A foreign selection resolves against neither endpoint of `el`, so an
		// unguarded walk hands back a plausible end-of-block pair instead of null.
		const foreign = elsewhere.firstChild!;
		elsewhere.focus();
		select(foreign, 0, foreign, 2);
		expect(cursorIO().getRawSelection()).toBeNull();
	});

	it('reports no selection for a collapsed caret', () => {
		el.focus();
		select(text, 2, text, 2);
		expect(cursorIO().getRawSelection()).toBeNull();
	});

	it('clamps a marker-interior endpoint to raw 0 rather than dropping the selection', () => {
		// The snap target is a single caret intent and cannot stand in for one end
		// of a pair; the clamp already maps marker interior to raw 0, which is the
		// correct selection boundary for a drag that began inside the marker.
		el.focus();
		select(marker.firstChild!, 1, text, 2);
		expect(cursorIO(4).getRawSelection()).toEqual({ start: 0, end: 2 });
	});
});

describe('getRaw', () => {
	it('reads the caret inside the focused surface in raw offsets', () => {
		el.focus();
		select(text, 3, text, 3);
		expect(cursorIO().getRaw()).toBe(3);
	});

	it('returns null when the surface does not hold focus', () => {
		elsewhere.focus();
		select(text, 3, text, 3);
		expect(cursorIO(4).getRaw()).toBeNull();
	});

	it('falls back to the snap target when the browser holds no range', () => {
		el.focus();
		window.getSelection()!.removeAllRanges();
		expect(cursorIO(4).getRaw()).toBe(4);
	});

	it('falls back to the snap target when the caret is trapped in the marker', () => {
		el.focus();
		select(marker.firstChild!, 1, marker.firstChild!, 1);
		expect(cursorIO(4).getRaw()).toBe(4);
	});
});

describe('clampOutOfAmbient', () => {
	it('parks a marker-interior caret after the marker span', () => {
		el.focus();
		select(marker.firstChild!, 1, marker.firstChild!, 1);
		cursorIO().clampOutOfAmbient();

		const sel = window.getSelection()!;
		expect(sel.focusNode).toBe(text);
		expect(sel.focusOffset).toBe(0);
	});

	it('leaves a caret already past the marker alone', () => {
		el.focus();
		select(text, 2, text, 2);
		cursorIO().clampOutOfAmbient();

		const sel = window.getSelection()!;
		expect(sel.focusNode).toBe(text);
		expect(sel.focusOffset).toBe(2);
	});

	it('does not move a caret while the surface is unfocused', () => {
		elsewhere.focus();
		select(marker.firstChild!, 1, marker.firstChild!, 1);
		cursorIO().clampOutOfAmbient();

		const sel = window.getSelection()!;
		expect(sel.focusNode).toBe(marker.firstChild);
	});
});

describe('setRaw', () => {
	it('lands raw 0 just after the marker island, never inside it', () => {
		el.focus();
		cursorIO().setRaw(asRawOffset(0));

		const sel = window.getSelection()!;
		expect(marker.contains(sel.focusNode)).toBe(false);
		expect(sel.focusNode).toBe(text);
		expect(sel.focusOffset).toBe(0);
	});

	it('offsets past the marker land at ambientLength + offset in walk space', () => {
		el.focus();
		cursorIO().setRaw(asRawOffset(3));

		const sel = window.getSelection()!;
		expect(sel.focusNode).toBe(text);
		expect(sel.focusOffset).toBe(3);
	});
});
