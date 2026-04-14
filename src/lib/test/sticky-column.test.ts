import { describe, it, expect } from 'vitest';
import { createStickyColumnState } from '../sticky-column';

describe('createStickyColumnState', () => {
	it('produces independent instances', () => {
		const a = createStickyColumnState();
		const b = createStickyColumnState();
		a.capture(100);
		expect(a.get()).toBe(100);
		expect(b.get()).toBe(null);
	});

	it('initial state is null', () => {
		const s = createStickyColumnState();
		expect(s.get()).toBe(null);
	});

	it('capture sets value when null', () => {
		const s = createStickyColumnState();
		s.capture(150);
		expect(s.get()).toBe(150);
	});

	it('capture is idempotent when non-null', () => {
		const s = createStickyColumnState();
		s.capture(150);
		s.capture(200);
		expect(s.get()).toBe(150);
	});

	it('capture preserves the first value across multiple calls', () => {
		const s = createStickyColumnState();
		s.capture(150);
		s.capture(175);
		s.capture(100);
		s.capture(200);
		expect(s.get()).toBe(150);
	});

	it('reset clears the value', () => {
		const s = createStickyColumnState();
		s.capture(150);
		s.reset();
		expect(s.get()).toBe(null);
	});

	it('reset is idempotent', () => {
		const s = createStickyColumnState();
		s.reset();
		s.reset();
		expect(s.get()).toBe(null);
	});

	it('reset on already-null state stays null', () => {
		const s = createStickyColumnState();
		s.reset();
		expect(s.get()).toBe(null);
	});

	it('capture after reset sets fresh value', () => {
		const s = createStickyColumnState();
		s.capture(150);
		s.reset();
		s.capture(200);
		expect(s.get()).toBe(200);
	});

	it('capture rejects NaN', () => {
		const s = createStickyColumnState();
		s.capture(NaN);
		expect(s.get()).toBe(null);
	});

	it('capture rejects Infinity', () => {
		const s = createStickyColumnState();
		s.capture(Infinity);
		expect(s.get()).toBe(null);
	});

	it('capture rejects -Infinity', () => {
		const s = createStickyColumnState();
		s.capture(-Infinity);
		expect(s.get()).toBe(null);
	});

	it('capture accepts zero', () => {
		const s = createStickyColumnState();
		s.capture(0);
		expect(s.get()).toBe(0);
	});

	it('capture accepts negative finite values', () => {
		// Edge case: cursor at a position left of the editor (shouldn't happen
		// in practice, but the state module doesn't restrict sign).
		const s = createStickyColumnState();
		s.capture(-10);
		expect(s.get()).toBe(-10);
	});
});
