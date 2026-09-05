import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
	arbBlankSeparatedGfmDoc,
	arbGfmDoc,
	arbIndentedGfmDoc,
	arbInlineSource,
	arbLargeDoc,
	arbLiveDoc,
	arbPluginBlockSource,
	arbPluginGfmDoc,
	arbPluginInlineSource,
	arbPluginInlineToken,
	arbRawString
} from './arbitraries';

// A generator that cannot draw a shape proves nothing about it, and the shapes below were
// missing from lanes whose properties are entirely about them: three structural lanes drew pure
// ASCII, two never drew CRLF. The floors are the audit's own measurement kept as a gate —
// counted by shape — so a weight tweak that quietly starves one fails here rather than at the
// next audit. Fixed seed on purpose: a coverage floor that flakes is not a floor, which is also
// why this suite stays off the fresh lane.

const DRAWS = 400;
const SEED = 20260814;

/** Shapes a byte-level defect hides in: multi-unit scalars under a slice, the cluster whose base
 *  and mark a boundary can land between, and the two-byte line ending every offset either counts as
 *  one boundary or corrupts. */
const SHAPES = {
	'non-ASCII': (source: string) => [...source].some((char) => char.charCodeAt(0) > 0x7f),
	'accented Latin': (source: string) => /[À-ɏ]/u.test(source),
	CJK: (source: string) => /[一-鿿]/u.test(source),
	'an astral pair': (source: string) => /[\u{10000}-\u{10ffff}]/u.test(source),
	'a combining cluster': (source: string) => /\p{M}/u.test(source),
	CRLF: (source: string) => source.includes('\r\n'),
	LF: (source: string) => /(^|[^\r])\n/.test(source)
};

type Shape = keyof typeof SHAPES;

/**
 * A lane's per-shape floor: a count, or the reason the lane's own purpose puts the shape out of
 * reach. A reason keeps a missing shape declared rather than absent — the same visible-not-silent
 * vocabulary the conformance kits use, and the alternative (a floor of zero) reads as measured.
 */
interface Lane {
	name: string;
	arbitrary: fc.Arbitrary<string>;
	/** Draws per lane. The scale lane costs ~100KB a draw, so it samples far fewer. */
	draws?: number;
	floors: Record<Shape, number | string>;
}

/** Well under every measured rate: the claim is that the shape is REACHED, not that its weight
 *  never moves. Astral pairs sit lowest, being one word of one vocabulary. */
const DOC_FLOOR: Record<Shape, number> = {
	'non-ASCII': 100,
	'accented Latin': 20,
	CJK: 20,
	'an astral pair': 20,
	'a combining cluster': 20,
	CRLF: 100,
	LF: 100
};

/** An inline-fragment lane's only line ending is a HARD BREAK, one fragment among many rather than
 *  a separator every block carries, so its endings floor reads that rate and not a document's. */
const INLINE_FLOOR: Record<Shape, number> = { ...DOC_FLOOR, CRLF: 10, LF: 10 };

const NO_LINE = 'a rung-token lane draws no line ending at all: every token is one line';

/** The composed plugin lanes draw a built-in arm too, so their non-ASCII and line-ending shapes
 *  can be met without one plugin byte carrying either — the construct-only lanes are what bind. */
const PLUGIN_CONSTRUCT_FLOOR: Record<Shape, number | string> = DOC_FLOOR;

const LANES: Lane[] = [
	{ name: 'arbGfmDoc', arbitrary: arbGfmDoc, floors: DOC_FLOOR },
	{ name: 'arbBlankSeparatedGfmDoc', arbitrary: arbBlankSeparatedGfmDoc, floors: DOC_FLOOR },
	{ name: 'arbIndentedGfmDoc', arbitrary: arbIndentedGfmDoc, floors: DOC_FLOOR },
	{ name: 'arbLiveDoc', arbitrary: arbLiveDoc, floors: DOC_FLOOR },
	{ name: 'arbPluginBlockSource', arbitrary: arbPluginBlockSource, floors: PLUGIN_CONSTRUCT_FLOOR },
	{
		name: 'arbPluginInlineToken',
		arbitrary: arbPluginInlineToken,
		floors: { ...PLUGIN_CONSTRUCT_FLOOR, CRLF: NO_LINE, LF: NO_LINE }
	},
	{ name: 'arbPluginGfmDoc', arbitrary: arbPluginGfmDoc, floors: DOC_FLOOR },
	{ name: 'arbPluginInlineSource', arbitrary: arbPluginInlineSource, floors: INLINE_FLOOR },
	{ name: 'arbInlineSource', arbitrary: arbInlineSource, floors: INLINE_FLOOR },
	{
		name: 'arbLargeDoc',
		arbitrary: arbLargeDoc,
		// Each draw is ~100KB, so the lane samples for reach rather than density.
		draws: 100,
		floors: {
			'non-ASCII': 10,
			'accented Latin': 10,
			CJK: 10,
			'an astral pair': 10,
			'a combining cluster': 10,
			CRLF: 20,
			LF: 20
		}
	}
];

describe.each(LANES.map((lane) => [lane.name, lane] as const))(
	'%s draws the shapes its properties are about',
	(name, lane) => {
		const draws = fc.sample(lane.arbitrary, { numRuns: lane.draws ?? DRAWS, seed: SEED });

		it.each(Object.keys(SHAPES) as Shape[])('draws %s', (shape) => {
			const floor = lane.floors[shape];
			if (typeof floor === 'string') {
				expect(floor.length, `${name} ${shape} exclusion is documented`).toBeGreaterThan(20);
				return;
			}
			const found = draws.filter(SHAPES[shape]).length;
			expect(found, `${name} drew ${shape} in ${found} of ${draws.length}`).toBeGreaterThanOrEqual(
				floor
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
	}
);

// The byte shapes above say nothing about CONSTRUCTS, and the inline lane is the one whose whole
// job is their adjacency. Two rows are the typing seat's: an asterisk nest, whose shared run serves
// both pairs, and a run enclosing a BARE autolink, whose URL scanner swallows the closer beside it.
describe('arbInlineSource draws the construct adjacencies its properties are about', () => {
	const draws = fc.sample(arbInlineSource, { numRuns: DRAWS, seed: SEED });

	const CONSTRUCTS: Record<string, [RegExp, number]> = {
		'a run nested in a run of its own kind': [/(~~?|__?)[^~_]+ \1[^~_]+\1 [^~_]+\1/, 40],
		'an asterisk run nested in a run of its own kind': [
			/\*\*?[^*]+ \*\*?[^*]+\*\*? [^*]+\*\*?/,
			30
		],
		'a run whose own space kills its flanking': [/(~~|__|\*\*|~|_|\*) [^~_*]+ \1/, 30],
		'a run enclosing an autolink': [/[*~_]+[^\s*~_@]+@[^\s*~_@]+/, 20],
		'a run enclosing a bare autolink': [/[*~_]+www\.[^\s*~_]+[*~_]+/, 20],
		'a code span holding a delimiter run': [/`[^`]*\*\*[^`]*`/, 10],
		'an escape against a run': [/\\\*[^\s*]*\*|\*[^\s*]*\\\*/, 5]
	};

	it.each(Object.entries(CONSTRUCTS))('draws %s', (shape, [pattern, floor]) => {
		const found = draws.filter((source) => pattern.test(source)).length;
		expect(found, `drew ${shape} in ${found} of ${DRAWS}`).toBeGreaterThanOrEqual(floor);
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
