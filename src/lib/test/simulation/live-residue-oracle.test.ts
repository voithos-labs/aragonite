// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { unpaintedResidue } from './live-screen-reading';

// What live-mode.md § 4.1 calls residue, as the property suites and the fuzzer count it.
// Miss-analysis: the count was a regex over the asterisk family, so it could see neither the shape
// a join actually leaves (`[](url)`, which the regex's own header set aside) nor the difference
// between a pair enclosing nothing and two real runs meeting. It flagged the second and missed the
// first, in one check.

const residue = (source: string) => unpaintedResidue(parse(source));

describe('the residue oracle counts what hides, off the policy table', () => {
	it('counts an emptied construct whose row declares the unwrap', () => {
		expect(residue('[](url) more\n')).toBe(1);
		expect(residue('a [x](url) more\n')).toBe(0);
	});

	// The policy row is the answer, not the delimiters: an image with an empty alt is still an image.
	it('leaves a row that declares no unwrap uncounted', () => {
		expect(residue('![](url) more\n')).toBe(0);
	});

	// The distinction § 4.1 draws: bytes the user saw are not residue, whatever they spell.
	it('skips a run the reader can see', () => {
		expect(residue('**** more\n')).toBe(0);
		expect(residue('[](url)\n')).toBe(0);
	});

	// The three places #136 hit: a rewrite splicing bytes out lets two runs meet, which the regex
	// read as a pair enclosing nothing wherever every asterisk of it was hidden.
	it('does not read two legitimate runs meeting as a pair enclosing nothing', () => {
		expect(residue('**bold*****foo***foo\n')).toBe(0);
		expect(residue('****.****\n')).toBe(0);
	});
});
