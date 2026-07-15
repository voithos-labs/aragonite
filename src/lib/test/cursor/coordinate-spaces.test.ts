// Pins the conversion directions (a flipped ± is a real caret bug) and, at the
// type level, that the brands reject cross-space and unbranded values.

import { describe, it, expect } from 'vitest';
import {
	asDomTextOffset,
	asEditorX,
	asRawOffset,
	asViewportX,
	toDomTextOffset,
	toEditorX,
	toRawOffset,
	toViewportX,
	type DomTextOffset,
	type RawOffset
} from '../../cursor/coordinate-spaces';

describe('coordinate-space conversions', () => {
	it('raw ↔ dom-text adds/subtracts the ambient length', () => {
		expect(toDomTextOffset(asRawOffset(5), 2)).toBe(7);
		expect(toRawOffset(asDomTextOffset(7), 2)).toBe(5);
	});

	it('editor ↔ viewport X adds/subtracts the editor left', () => {
		expect(toViewportX(asEditorX(50), 30)).toBe(80);
		expect(toEditorX(asViewportX(80), 30)).toBe(50);
	});
});

describe('coordinate-space brands (compile-time pins)', () => {
	// An unused @ts-expect-error directive is itself a check error, so a green
	// gate proves both directions: the mix fails to compile AND the brand has
	// not decayed to plain number.
	it('brands reject cross-space and unbranded values but stay usable as numbers', () => {
		const raw: RawOffset = asRawOffset(3);

		// @ts-expect-error a raw offset is not a walk-space offset
		const mixed: DomTextOffset = raw;
		void mixed;

		// @ts-expect-error a plain number needs a mint or conversion to enter a space
		const bare: RawOffset = 3;
		void bare;

		// @ts-expect-error an EditorX is not a ViewportX
		toEditorX(asEditorX(10), 0);

		// @ts-expect-error a pixel X is not a text offset
		toDomTextOffset(asEditorX(10), 0);

		expect(raw + 1).toBe(4);
	});
});
