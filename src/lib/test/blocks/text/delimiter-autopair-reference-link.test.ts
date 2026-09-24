import { describe, it, expect } from 'vitest';
import { resolveDelimiterAutoPair } from '$lib/components/blocks/text/delimiter-autopair';
import { buildLinkReferenceMap } from '$lib/core/inline/link-reference-resolver';
import { parse } from '$lib/core/parser';
import { defaultGrammarView } from '$lib/schema/block-openers';

// The auto-pair reads the line with the document's link definitions, so a `*` inside a reference
// link is not taken for the closer of a `*` outside it (GH #455).
// Miss-analysis: the auto-pair suites typed beside inline links only, and the scans took no
// resolver, so a reference link read as brackets there and nothing compared the two readings.

const resolver = buildLinkReferenceMap(parse('[ref]: https://x.com\n').children).resolve;
const withDefinitions = { current: resolver, grammar: defaultGrammarView };

const type = (text: string, caret: number, typed: string) =>
	resolveDelimiterAutoPair(
		text,
		{ start: 0, end: text.length },
		caret,
		typed,
		undefined,
		withDefinitions
	);

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
