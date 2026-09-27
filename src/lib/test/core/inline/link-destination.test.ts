import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/core/inline';
import { parse } from '$lib/core/parser';

// A NUL inside an angle-bracket destination or a title refuses it, for inline links and
// definitions alike; commonmark.js swaps NUL for U+FFFD first, so this pin is by hand.
const NUL = '\u0000';

describe('a NUL refuses an angle-bracket destination or a title', () => {
	it.each([
		['angle-bracket destination', `<a${NUL}b>`],
		['title', `/u "t${NUL}"`]
	])('in an inline link: %s', (_part, tail) => {
		const source = `[x](${tail})`;
		expect(parseInline(source, 0, source.length).map((n) => n.kind)).not.toContain('link');
	});

	it.each([
		['angle-bracket destination', `<a${NUL}b>`],
		['title', `/u "t${NUL}"`]
	])('in a link reference definition: %s', (_part, tail) => {
		expect(parse(`[x]: ${tail}\n`).children.map((n) => n.kind)).toEqual(['paragraph']);
	});
});
