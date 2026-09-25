import { describe, it, expect } from 'vitest';
import { resolveDelimiterAutoPair } from '$lib/components/blocks/text/delimiter-autopair';
import { buildLinkReferenceMap } from '$lib/core/inline/link-reference-resolver';
import { parse } from '$lib/core/parser';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';

// The auto-pair reads the line with the document's link definitions, so a `*` inside a reference
// link is not taken for the closer of a `*` outside it (GH #455).
// Miss-analysis: the auto-pair suites typed beside inline links only, and the scans took no
// resolver, so a reference link read as brackets there and nothing compared the two readings.

const resolver = buildLinkReferenceMap(parse('[ref]: https://x.com\n').children).resolve;
const withDefinitions = fixtureReading({ current: resolver });

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

// The paired line is a byte longer than the line typed into, and a scan bounded by the shorter
// line cut off its last byte: a link's closing bracket there, so the link read as text.
// Miss-analysis: the closer scan was only asked with the caret at the line's end, where the typed
// byte itself widened the bound.
describe('auto-pair reads the whole paired line', () => {
	it.each([
		{ form: 'a reference link', text: '*[a][ref]' },
		{ form: 'an inline link', text: '*[a](u)' }
	])('does not close a run across $form that ends the line', ({ text }) => {
		expect(type(text, 3, '*')).toBeNull();
	});
});
