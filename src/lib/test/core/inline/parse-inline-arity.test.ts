// Omitting the bounds compares against `undefined` at every step and hands back one text
// node — a plausible answer with the inline structure silently absent. Untyped consumers
// reach that shape without a compile error, so the arity is guarded at runtime too.
import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/core/inline';

const callWith = (...args: unknown[]) =>
	(parseInline as unknown as (...a: unknown[]) => unknown)(...args);

describe('parseInline — bounds are required', () => {
	it('throws on the source-only call rather than returning one text node', () => {
		expect(() => callWith('a *b* c')).toThrow(TypeError);
		expect(() => callWith('a *b* c')).toThrow(/parseInline\(src, 0, src\.length\)/);
	});

	it('throws when only the start bound is supplied', () => {
		expect(() => callWith('a *b* c', 0)).toThrow(TypeError);
	});

	it('throws on non-numeric bounds', () => {
		expect(() => callWith('a *b* c', '0', 7)).toThrow(TypeError);
		expect(() => callWith('a *b* c', 0, NaN)).toThrow(TypeError);
	});

	it('still scans when both bounds are present', () => {
		expect(parseInline('a *b* c', 0, 7).some((n) => n.kind === 'emphasis')).toBe(true);
	});

	it('accepts an empty range without throwing', () => {
		expect(parseInline('abc', 1, 1)).toEqual([]);
	});
});
