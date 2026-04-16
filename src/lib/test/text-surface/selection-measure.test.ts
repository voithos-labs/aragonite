// @vitest-environment jsdom
// Runner note: needs jsdom for Range.getClientRects. The rect geometry is
// trivial under jsdom (zero-sized rects), so this suite only checks the
// function's boundary handling — real pixel measurement is covered by the
// cross-block selection e2e specs.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { measurePartialRectsInContentEditable } from '../../text-surface/selection-measure';

describe('measurePartialRectsInContentEditable', () => {
	let el: HTMLDivElement;

	beforeEach(() => {
		el = document.createElement('div');
		el.contentEditable = 'true';
		el.textContent = 'hello world';
		document.body.appendChild(el);
	});

	afterEach(() => {
		el.remove();
	});

	it('returns an empty array for a zero-length range', () => {
		const rects = measurePartialRectsInContentEditable(el, 3, 3);
		expect(rects).toEqual([]);
	});

	it('returns an array for a valid range within the element', () => {
		const rects = measurePartialRectsInContentEditable(el, 0, 5);
		expect(Array.isArray(rects)).toBe(true);
	});

	it('clamps out-of-range offsets without throwing', () => {
		expect(() => measurePartialRectsInContentEditable(el, 0, 9999)).not.toThrow();
	});
});
