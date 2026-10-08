import { describe, it, expect } from 'vitest';
import { resolveDelimiterAutoPair } from '#lib/components/blocks/text/delimiter-autopair.js';
import { buildLinkReferenceMap } from '#lib/core/inline/link-reference-resolver.js';
import { parse } from '#lib/core/parser.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';

// The auto-pair reads the line with the document's link definitions, so a `*` inside a reference
// link is not taken for the closer of a `*` outside it.
// Miss-analysis: GH #455, the auto-pair suites typed beside inline links, never reference ones.

const resolver = buildLinkReferenceMap(parse('[ref]: https://x.com\n').children).resolve;
const withDefinitions = fixtureReading({ resolver: resolver });

const type = (text: string, caret: number, typed: string) =>
	resolveDelimiterAutoPair(text, { start: 0, end: text.length }, caret, typed, withDefinitions, {
		ownPair: null
	});

describe('auto-pair beside a reference link', () => {
	it('leaves a * typed before a * inside the link to the browser', () => {
		expect(type('*[a*][ref]', 3, '*')).toBeNull();
	});

	it('does not close a run that opens outside the link', () => {
		expect(type('*[a][ref]', 3, '*')).toBeNull();
	});

	it('still steps over the closer of emphasis inside the link text', () => {
		expect(type('[*a*][ref]', 3, '*')).toEqual({
			kind: 'step-over',
			caret: 4,
			overConstruct: true
		});
	});
});

// The paired line is a byte longer than the typed line, and that last byte can close a link.
// Miss-analysis: the closer scan only ran with the caret at line end, which hid the short bound.
describe('auto-pair reads the whole paired line', () => {
	it.each([
		{ form: 'a reference link', text: '*[a][ref]' },
		{ form: 'an inline link', text: '*[a](u)' }
	])('does not close a run across $form that ends the line', ({ text }) => {
		expect(type(text, 3, '*')).toBeNull();
	});
});
