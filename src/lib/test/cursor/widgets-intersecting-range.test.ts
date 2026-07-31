// @vitest-environment jsdom
// Verifies the offset/intersection logic of `widgetsIntersectingRange` — which
// atomic widgets a raw range covers. Pixel geometry (the bounding rects the
// search/selection overlays actually paint) is covered by e2e.

import { describe, it, expect, beforeEach } from 'vitest';
import { asDomTextOffset } from '../../cursor/coordinate-spaces';
import { widgetsIntersectingRange } from '../../cursor/widget-offset';

describe('widgetsIntersectingRange', () => {
	let el: HTMLElement;

	beforeEach(() => {
		el = document.createElement('div');
	});

	// A widget spanning raw [start, end) with non-empty inner content, so a walker
	// that wrongly read textContent (0 chars) would diverge from the source range.
	function widget(start: number, end: number): HTMLElement {
		const w = document.createElement('span');
		w.setAttribute('data-inline-widget', '');
		w.setAttribute('data-image-widget', '');
		w.setAttribute('contenteditable', 'false');
		w.setAttribute('data-source-start', String(start));
		w.setAttribute('data-source-end', String(end));
		w.appendChild(document.createElement('img'));
		return w;
	}

	it('returns the widget when the range lies entirely inside its source span', () => {
		// Image-only list item: the marker text counts toward the running offset,
		// then the widget occupies [2, 32). A match like "In a list" sits inside it.
		const marker = document.createTextNode('- ');
		const w = widget(0, 30);
		el.append(marker, w);

		// A match at ambient-adjusted [5, 9) falls inside the widget span [2, 32)
		// even though the widget contributes 0 chars to textContent.
		expect(widgetsIntersectingRange(el, asDomTextOffset(5), asDomTextOffset(9))).toEqual([w]);
	});

	it('returns no widget when the range is fully before it', () => {
		const lead = document.createTextNode('hello ');
		const w = widget(0, 10);
		el.append(lead, w);
		// "hello " is [0,6); widget is [6,16). A range inside the lead text only.
		expect(widgetsIntersectingRange(el, asDomTextOffset(0), asDomTextOffset(5))).toEqual([]);
	});

	it('returns no widget when the range is fully after it', () => {
		const w = widget(0, 10);
		const trail = document.createTextNode(' world');
		el.append(w, trail);
		// Widget is [0,10); trailing text is [10,16). A range inside the trail only.
		expect(widgetsIntersectingRange(el, asDomTextOffset(12), asDomTextOffset(15))).toEqual([]);
	});

	it('treats the widget span as half-open: a range ending exactly at its start excludes it', () => {
		const lead = document.createTextNode('ab');
		const w = widget(0, 10);
		el.append(lead, w);
		// Lead is [0,2); widget starts at 2. [0,2) touches but does not enter it.
		expect(widgetsIntersectingRange(el, asDomTextOffset(0), asDomTextOffset(2))).toEqual([]);
	});

	it('treats the widget span as half-open: a range starting exactly at its end excludes it', () => {
		const w = widget(0, 10);
		const trail = document.createTextNode('xy');
		el.append(w, trail);
		// Widget is [0,10); trailing text starts at 10. [10,12) starts at the edge.
		expect(widgetsIntersectingRange(el, asDomTextOffset(10), asDomTextOffset(12))).toEqual([]);
	});

	it('returns a widget the range partially overlaps from the left', () => {
		const lead = document.createTextNode('abc');
		const w = widget(0, 10);
		el.append(lead, w);
		// Lead [0,3), widget [3,13). A range [1,5) crosses into the widget.
		expect(widgetsIntersectingRange(el, asDomTextOffset(1), asDomTextOffset(5))).toEqual([w]);
	});

	it('returns every widget a range straddles, in document order', () => {
		const a = widget(0, 5);
		const mid = document.createTextNode(' mid ');
		const b = widget(5, 10);
		el.append(a, mid, b);
		// a [0,5), mid [5,10), b [10,15). A range [3,12) covers both widgets.
		expect(widgetsIntersectingRange(el, asDomTextOffset(3), asDomTextOffset(12))).toEqual([a, b]);
	});

	it('ignores a zero-length widget (nothing to cover)', () => {
		const w = widget(7, 7); // data-source-start === data-source-end
		el.append(w);
		expect(widgetsIntersectingRange(el, asDomTextOffset(0), asDomTextOffset(10))).toEqual([]);
	});

	// A zero-byte widget decoration island (data-source-start === data-source-end) is deliberately
	// skipped by selection cover-rects — nothing is selected — so nobody "fixes" the guard.
	it('ignores a zero-length decoration widget island', () => {
		const island = document.createElement('span');
		island.setAttribute('data-inline-widget', '');
		island.setAttribute('data-decoration-island', '');
		island.setAttribute('data-source-start', '4');
		island.setAttribute('data-source-end', '4');
		el.append(document.createTextNode('abcd'), island, document.createTextNode('efgh'));
		expect(widgetsIntersectingRange(el, asDomTextOffset(0), asDomTextOffset(8))).toEqual([]);
	});

	it('returns nothing for a widget-free container', () => {
		el.append(document.createTextNode('plain text'));
		expect(widgetsIntersectingRange(el, asDomTextOffset(0), asDomTextOffset(5))).toEqual([]);
	});
});
