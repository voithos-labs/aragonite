import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
	arbBlankSeparatedGfmDoc,
	arbGfmDoc,
	arbIndentedGfmDoc,
	arbLiveDoc,
	arbRawString
} from './arbitraries';

// A generator that cannot draw a shape proves nothing about it, and the shapes below were
// missing from lanes whose properties are entirely about them: three structural lanes drew pure
// ASCII, two never drew CRLF. The floors are the audit's own measurement kept as a gate — 400
// draws per lane, counted by shape — so a weight tweak that quietly starves one fails here
// rather than at the next audit. Fixed seed on purpose: a coverage floor that flakes is not a
// floor, which is also why this suite stays off the fresh lane.

const DRAWS = 400;
const SEED = 20260814;

/** Shapes a byte-level defect hides in: multi-unit scalars under a slice, and the two-byte
 *  line ending every offset either counts as one boundary or corrupts. */
const SHAPES = {
	'non-ASCII': (source: string) => [...source].some((char) => char.charCodeAt(0) > 0x7f),
	'accented Latin': (source: string) => /[À-ɏ]/u.test(source),
	CJK: (source: string) => /[一-鿿]/u.test(source),
	'an astral pair': (source: string) => /[\u{10000}-\u{10ffff}]/u.test(source),
	CRLF: (source: string) => source.includes('\r\n'),
	LF: (source: string) => /(^|[^\r])\n/.test(source)
};

const LANES: [name: string, arbitrary: fc.Arbitrary<string>][] = [
	['arbGfmDoc', arbGfmDoc],
	['arbBlankSeparatedGfmDoc', arbBlankSeparatedGfmDoc],
	['arbIndentedGfmDoc', arbIndentedGfmDoc],
	['arbLiveDoc', arbLiveDoc]
];

/** Well under every measured rate: the claim is that the shape is REACHED, not that its weight
 *  never moves. Astral pairs sit lowest, being one word of one vocabulary. */
const FLOOR: Record<keyof typeof SHAPES, number> = {
	'non-ASCII': 100,
	'accented Latin': 20,
	CJK: 20,
	'an astral pair': 20,
	CRLF: 100,
	LF: 100
};

describe.each(LANES)('%s draws the shapes its properties are about', (name, arbitrary) => {
	const draws = fc.sample(arbitrary, { numRuns: DRAWS, seed: SEED });

	it.each(Object.keys(SHAPES) as (keyof typeof SHAPES)[])('draws %s', (shape) => {
		const found = draws.filter(SHAPES[shape]).length;
		expect(found, `${name} drew ${shape} in ${found} of ${DRAWS}`).toBeGreaterThanOrEqual(
			FLOOR[shape]
		);
	});

	// The other half of the weighting: parse behavior differences are mostly offset arithmetic,
	// not grammar, so a corpus drowning in non-ASCII would spend its draws on the same class.
	it('keeps ASCII the bulk of the bytes', () => {
		const bytes = draws.join('');
		const ascii = [...bytes].filter((char) => char.charCodeAt(0) < 0x80).length;
		expect(ascii / bytes.length).toBeGreaterThan(0.9);
	});

	// Lone surrogates are the one shape the corpus deliberately excludes: no UTF-8 boundary
	// round-trips one, so no document holding one can reach the editor through any documented
	// door. The gesture fuzzer's well-formedness oracle reads that as its precondition.
	it('draws no ill-formed source', () => {
		expect(draws.filter((source) => !source.isWellFormed())).toEqual([]);
	});
});

// The garbage lane carries the shape the structured ones cannot: a control character no markdown
// grammar mentions, which a byte-preserving parser has to hand back untouched anyway.
describe('arbRawString', () => {
	const draws = fc.sample(arbRawString, { numRuns: DRAWS, seed: SEED });

	it('draws control characters', () => {
		const found = draws.filter((source) => [...source].some(isControl)).length;
		expect(found, `drew a control character in ${found} of ${DRAWS}`).toBeGreaterThanOrEqual(40);
	});

	it('draws no ill-formed source', () => {
		expect(draws.filter((source) => !source.isWellFormed())).toEqual([]);
	});
});

function isControl(char: string): boolean {
	const code = char.charCodeAt(0);
	return code === 0x7f || (code < 0x20 && char !== '\n' && char !== '\r' && char !== '\t');
}
