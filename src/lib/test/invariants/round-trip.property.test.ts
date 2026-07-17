import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { arbRawString, arbCrlfString, arbDeepNesting, arbGfmDoc } from './arbitraries';

// G2.1 marquee invariant: serialize(parse(s)) === s for ALL inputs. The parser
// is total (never throws; unknown syntax becomes paragraph/unrecognized) and the
// serializer is pure byte concatenation, so any counterexample is a real defect.
// Seeds are fixed so a regression surfaces deterministically rather than flaking.

const PARAMS = { numRuns: 1000, seed: 424242 } as const;

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
});

// G2.2: the parser absorbs unterminated blocks to EOF rather than recovering.
// Round-trip must still hold for these deliberately-truncated states.
describe('G2.2 EOF edge states', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'unclosed fenced code (backticks)', source: '```js\ncode\nmore' },
		{ name: 'unclosed fenced code, trailing newline', source: '```\ncode\n' },
		{ name: 'unclosed fenced code, info only', source: '~~~rust' },
		{ name: 'unterminated HTML block', source: '<div>\ncontent\nno close' },
		{ name: 'unterminated script block', source: '<script>\nfoo()' },
		{ name: 'unterminated HTML comment', source: '<!-- comment never closes' },
		{ name: 'unterminated multi-line comment', source: '<!--\nline\nmore' },
		{ name: 'unterminated CDATA', source: '<![CDATA[\ndata' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			expect(serialize(parse(source))).toBe(source);
		});
	}
});

// Adversarial fixed cases the generators cannot reach at useful sizes — their
// nesting dial (arbDeepNesting) tops out around a dozen levels, well below the
// container-depth cap these exercise.
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
