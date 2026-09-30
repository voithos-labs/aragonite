// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { unpaintedResidue } from './live-screen-reading';

// What live-mode.md § 4.1 calls residue, as the property suites and the fuzzer count it.
// Miss-analysis: the count was an asterisk regex, blind to `[](url)` and to two real runs meeting.

const residue = (source: string) => unpaintedResidue(parse(source));

describe('the residue check counts what hides, off the policy table', () => {
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

	// A rewrite splicing bytes out can let two real runs meet with every asterisk hidden.
	it('does not read two legitimate runs meeting as a pair enclosing nothing', () => {
		expect(residue('**bold*****foo***foo\n')).toBe(0);
		expect(residue('****.****\n')).toBe(0);
	});
});
