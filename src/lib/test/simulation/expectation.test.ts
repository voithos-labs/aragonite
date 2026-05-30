import { describe, it, expect } from 'vitest';
import { ExpectationTracker } from '$lib/editor/e2e/simulation/expectation';

describe('ExpectationTracker', () => {
	it('predicts printable append before the trailing newline', () => {
		const t = new ExpectationTracker('\n');
		expect(t.appendChar('H')).toBe('H\n');
		expect(t.appendChar('i')).toBe('Hi\n');
		expect(t.expectedSource).toBe('Hi\n');
	});

	it('preserves a typed trailing space inside content', () => {
		const t = new ExpectationTracker('Hi\n');
		expect(t.appendChar(' ')).toBe('Hi \n');
		expect(t.appendChar('x')).toBe('Hi x\n');
	});

	it('appends into the gap after an Enter-materialized blank block', () => {
		const t = new ExpectationTracker('Hi x\n\n');
		expect(t.appendChar('Y')).toBe('Hi x\nY\n');
	});

	it('backspaceAtEnd removes the last content char', () => {
		const t = new ExpectationTracker('Hi\n');
		expect(t.backspaceAtEnd()).toBe('H\n');
		expect(t.backspaceAtEnd()).toBe('\n');
	});

	it('backspaceAtEnd is a no-op at an empty baseline', () => {
		const t = new ExpectationTracker('\n');
		expect(t.backspaceAtEnd()).toBe('\n');
	});

	it('resync adopts observed source after auto-behavior', () => {
		const t = new ExpectationTracker('\n');
		t.resync('- a\n- b\n');
		expect(t.expectedSource).toBe('- a\n- b\n');
	});

	it('handles a source without a trailing newline', () => {
		const t = new ExpectationTracker('x');
		expect(t.appendChar('y')).toBe('xy');
	});
});
