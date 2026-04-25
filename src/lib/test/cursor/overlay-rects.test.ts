// @vitest-environment jsdom
// Needs jsdom for Range.getClientRects. Rects are zero-sized under jsdom, so this suite
// only verifies boundary handling — real pixel measurement is covered by e2e specs.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { measurePartialRectsInContentEditable } from '../../cursor/overlay-rects';

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
