// Pins the conversion directions (a flipped ± is a real caret bug) and, at the
// type level, that the brands reject cross-space and unbranded values.

import { describe, it, expect } from 'vitest';
import {
	asCellIndex,
	asDomTextOffset,
	asEditorX,
	asRawOffset,
	asViewportX,
	toClampedRawOffset,
	toDomTextOffset,
	toEditorX,
	toRawOffset,
	toViewportX,
	type CellIndex,
	type DomTextOffset,
	type RawOffset
} from '../../cursor/coordinate-spaces';
import type { CursorBackend, EditableSurfaceDeps } from '../../components/blocks/editable-surface';

describe('coordinate-space conversions', () => {
	it('raw ↔ dom-text adds/subtracts the ambient length', () => {
		expect(toDomTextOffset(asRawOffset(5), 2)).toBe(7);
		expect(toRawOffset(asDomTextOffset(7), 2)).toBe(5);
	});

	it('clamped raw conversion subtracts, clamping marker-interior positions to 0', () => {
		expect(toClampedRawOffset(asDomTextOffset(7), 2)).toBe(5);
		expect(toClampedRawOffset(asDomTextOffset(1), 2)).toBe(0);
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

	it('a cell index and a raw offset are distinct spaces', () => {
		// @ts-expect-error a cell index is not a raw offset
		const intoRaw: RawOffset = asCellIndex(3);
		void intoRaw;

		// @ts-expect-error a raw offset is not a cell index
		const intoCell: CellIndex = asRawOffset(3);
		void intoCell;

		expect(asCellIndex(3) + 1).toBe(4);
	});

	// Assignment-shaped (never invoked) so the pins are runtime-free; call-site
	// checking would be bivariance-exempt on methods, assignment is not.
	it('the editable-surface seam rejects wrong-space offsets', () => {
		type SetRawArg = Parameters<CursorBackend['setRaw']>[0];

		// @ts-expect-error a walk-space offset cannot enter the raw-space backend
		const domTextIntoRaw: SetRawArg = asDomTextOffset(3);
		void domTextIntoRaw;

		// @ts-expect-error a pixel X cannot enter the raw-space backend
		const editorXIntoRaw: SetRawArg = asEditorX(3);
		void editorXIntoRaw;

		// @ts-expect-error a cell index cannot enter the raw-space backend
		const cellIntoRaw: SetRawArg = asCellIndex(3);
		void cellIntoRaw;

		// @ts-expect-error the focus-offset reader returns raw, not walk-space, offsets
		const focusRead: EditableSurfaceDeps['getFocusOffset'] = () => asDomTextOffset(3);
		void focusRead;

		expect(asRawOffset(3) satisfies SetRawArg).toBe(3);
	});
});
