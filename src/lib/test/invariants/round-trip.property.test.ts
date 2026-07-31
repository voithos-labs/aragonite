import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import {
	arbRawString,
	arbCrlfString,
	arbDeepNesting,
	arbGfmDoc,
	arbIndentedGfmDoc,
	arbLargeDoc,
	freshOrFixedSeed
} from './arbitraries';
import { describeRoundTrips } from '$lib/test/support/round-trip';

// G2.1 marquee invariant: serialize(parse(s)) === s for ALL inputs. The parser is total
// and the serializer is pure byte concatenation, so any counterexample is a real defect.

const PARAMS = { numRuns: 1000, seed: freshOrFixedSeed(424242) } as const;

function roundTrips(source: string): boolean {
	const doc = parse(source);
	return serialize(doc) === source;
}

describe('G2.1 round-trip + totality', () => {
	it('serialize(parse(s)) === s over raw garbage', () => {
		fc.assert(fc.property(arbRawString, roundTrips), PARAMS);
	});

	it('serialize(parse(s)) === s over valid-ish GFM docs', () => {
		fc.assert(fc.property(arbGfmDoc, roundTrips), PARAMS);
	});

	it('preserves mixed CR / LF / CRLF byte-for-byte', () => {
		fc.assert(fc.property(arbCrlfString, roundTrips), PARAMS);
	});

	it('preserves deeply nested container prefixes', () => {
		fc.assert(fc.property(arbDeepNesting, roundTrips), PARAMS);
	});

	it('serialize(parse(s)) === s across the block-indent boundary', () => {
		fc.assert(fc.property(arbIndentedGfmDoc, roundTrips), PARAMS);
	});
});

// G2.2: the parser absorbs unterminated blocks to EOF rather than recovering, and
// round-trip must hold for those truncated states too.
describeRoundTrips('G2.2 EOF edge states', [
	{ name: 'unclosed fenced code (backticks)', source: '```js\ncode\nmore' },
	{ name: 'unclosed fenced code, trailing newline', source: '```\ncode\n' },
	{ name: 'unclosed fenced code, info only', source: '~~~rust' },
	{ name: 'unterminated HTML block', source: '<div>\ncontent\nno close' },
	{ name: 'unterminated script block', source: '<script>\nfoo()' },
	{ name: 'unterminated HTML comment', source: '<!-- comment never closes' },
	{ name: 'unterminated multi-line comment', source: '<!--\nline\nmore' },
	{ name: 'unterminated CDATA', source: '<![CDATA[\ndata' }
]);

// The size tier: reaching the scale complexity defects live at, not sampling it densely.
// Shrinking is off because a 100KB counterexample shrinks for minutes and the raw case is
// already the diagnostic — the shapes are chosen, not searched.
describe('G2.1 round-trip at scale', () => {
	it('serialize(parse(s)) === s over ~100KB floods, runs and unclosed containers', () => {
		fc.assert(fc.property(arbLargeDoc, roundTrips), {
			numRuns: 20,
			seed: freshOrFixedSeed(424242),
			endOnFailure: true
		});
	}, 60_000);
});

// Fixed cases the generators cannot reach: arbDeepNesting tops out around a dozen levels,
// well below the container-depth cap these exercise.
describe('G2.1 adversarial nesting', () => {
	it('round-trips 2000-deep link bracket nesting', () => {
		const source = '['.repeat(2000) + 'a' + '](u)'.repeat(2000);
		expect(serialize(parse(source))).toBe(source);
	});

	it('round-trips a blockquote flood past the container-depth cap', () => {
		const source = '>'.repeat(5000) + ' x\n';
		expect(serialize(parse(source))).toBe(source);
	});

	it('round-trips a nested-list flood past the container-depth cap', () => {
		const source =
			Array.from({ length: 700 }, (_, i) => ' '.repeat(2 * i) + '- x').join('\n') + '\n';
		expect(serialize(parse(source))).toBe(source);
	}, 30_000);
});
