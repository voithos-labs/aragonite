// @vitest-environment jsdom
// Needs jsdom for Range.getClientRects. Rects are zero-sized under jsdom, so this suite
// only verifies boundary handling — real pixel measurement is covered by e2e specs.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { asDomTextOffset } from '../../cursor/coordinate-spaces';
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
		const rects = measurePartialRectsInContentEditable(el, asDomTextOffset(3), asDomTextOffset(3));
		expect(rects).toEqual([]);
	});

	it('clamps out-of-range offsets without throwing', () => {
		expect(() =>
			measurePartialRectsInContentEditable(el, asDomTextOffset(0), asDomTextOffset(9999))
		).not.toThrow();
	});
});
