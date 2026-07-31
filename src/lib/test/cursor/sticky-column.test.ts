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

// The door every keydown handler goes through. `reset()` stays public for the lifecycle/commit/
// paste callers, whose unconditional clear has no key to classify.
describe('noteKey', () => {
	const key = (k: string, altKey = false) => ({ key: k, altKey });
	const measure = (x: number | null) => () => (x === null ? null : asEditorX(x));

	function primed(x = 600) {
		const s = createStickyColumnState();
		s.capture(asEditorX(x));
		return s;
	}

	it('captures the measured column on a vertical arrow', () => {
		const s = createStickyColumnState();
		s.noteKey(key('ArrowDown'), measure(120));
		expect(s.get()).toBe(120);
	});

	for (const k of ['ArrowLeft', 'ArrowRight', 'a', 'Backspace', 'Enter', 'Escape']) {
		it(`resets on ${k}`, () => {
			const s = primed();
			s.noteKey(key(k), measure(120));
			expect(s.get()).toBeNull();
		});
	}

	for (const k of ['PageUp', 'PageDown', 'Shift', 'Control', 'Alt', 'Meta']) {
		it(`preserves on ${k}`, () => {
			const s = primed();
			s.noteKey(key(k), measure(120));
			expect(s.get()).toBe(600);
		});
	}

	// Alt+Arrow is the block-reorder chord, not caret nav.
	it('leaves the column untouched for Alt+Arrow', () => {
		const s = primed();
		s.noteKey(key('ArrowUp', true), measure(120));
		expect(s.get()).toBe(600);
	});

	it('still resets on Alt + a non-arrow key', () => {
		const s = primed();
		s.noteKey(key('x', true), measure(120));
		expect(s.get()).toBeNull();
	});

	// A caller holding a range rather than a caret supplies no measurement; a
	// capture key must then preserve, never silently clear.
	it('preserves on a vertical arrow when no measurement is available', () => {
		const s = primed();
		s.noteKey(key('ArrowDown'));
		expect(s.get()).toBe(600);
		s.noteKey(key('ArrowDown'), measure(null));
		expect(s.get()).toBe(600);
	});
});
