import { describe, it, expect } from 'vitest';
import { asEditorX } from '../../cursor/coordinate-spaces';
import { createStickyColumnState } from '../../cursor/sticky-column';

describe('createStickyColumnState', () => {
	it('produces independent instances', () => {
		const a = createStickyColumnState();
		const b = createStickyColumnState();
		a.capture(asEditorX(100));
		expect(a.get()).toBe(100);
		expect(b.get()).toBe(null);
	});

	it('capture sets value when null', () => {
		const s = createStickyColumnState();
		s.capture(asEditorX(150));
		expect(s.get()).toBe(150);
	});

	it('capture is idempotent when non-null', () => {
		const s = createStickyColumnState();
		s.capture(asEditorX(150));
		s.capture(asEditorX(200));
		expect(s.get()).toBe(150);
	});

	it('reset clears the value and is idempotent on null state', () => {
		const s = createStickyColumnState();
		expect(s.get()).toBe(null);
		s.capture(asEditorX(150));
		s.reset();
		expect(s.get()).toBe(null);
		s.reset();
		expect(s.get()).toBe(null);
	});

	it('capture after reset sets fresh value', () => {
		const s = createStickyColumnState();
		s.capture(asEditorX(150));
		s.reset();
		s.capture(asEditorX(200));
		expect(s.get()).toBe(200);
	});

	for (const invalid of [NaN, Infinity, -Infinity]) {
		it(`capture rejects ${invalid}`, () => {
			const s = createStickyColumnState();
			s.capture(asEditorX(invalid));
			expect(s.get()).toBe(null);
		});
	}

	it('capture accepts zero', () => {
		const s = createStickyColumnState();
		s.capture(asEditorX(0));
		expect(s.get()).toBe(0);
	});

	it('capture accepts negative finite values', () => {
		const s = createStickyColumnState();
		s.capture(asEditorX(-10));
		expect(s.get()).toBe(-10);
	});
});
