// GH #95: a cut landing ON a line ending — the caret at the end of a soft-broken line —
// terminated nothing, so the first half minted an ending of its own while the second opened
// with the original one. The blank line it made turned the second half into two blocks and
// the reparse kept only the first, destroying every line past the cut.
//
// Miss-analysis: the split suite asserted each half's raw and never the document's bytes, so a
// drop that left two plausible halves — `'aaa\n'` beside an empty second — read as an ordinary
// end-of-block split. Every row below states the bytes.

import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { splitNode } from '../../tree-operations';
import { describeConvergence } from '../harness/parse-converged';

/**
 * The document's bytes, which is the oracle a per-half raw assertion cannot be: a first half of
 * `'aaa\n'` beside an empty second reads as an ordinary end-of-block split however much the
 * dropped block took with it. The shape must also reload as itself, or the loss returns on remount.
 */
function splitBytes(source: string, offset: number): string {
	const doc = parse(source);
	splitNode(doc, 0, offset, undefined, undefined);
	expect(describeConvergence(doc), `${JSON.stringify(source)} @${offset}`).toBeNull();
	return serialize(doc);
}

/** The CRLF twin's cut: each ending crossed is two bytes there rather than one (G4.20). */
const crlf = (source: string) => source.replace(/\n/g, '\r\n');
const crlfOffset = (source: string, offset: number) =>
	offset + (source.slice(0, offset).match(/\n/g)?.length ?? 0);

interface Row {
	what: string;
	source: string;
	offset: number;
	expected: string;
}

const ROWS: Row[] = [
	{
		what: 'a paragraph cut on its soft break',
		source: 'aaa\nbbb\n',
		offset: 3,
		expected: 'aaa\n\nbbb\n'
	},
	{
		what: 'a paragraph cut just past its soft break',
		source: 'aaa\nbbb\n',
		offset: 4,
		expected: 'aaa\n\nbbb\n'
	},
	{
		what: 'a three-line paragraph cut on its first soft break',
		source: 'aaa\nbbb\nccc\n',
		offset: 3,
		expected: 'aaa\n\nbbb\nccc\n'
	},
	{
		what: 'a three-line paragraph cut on its second soft break',
		source: 'aaa\nbbb\nccc\n',
		offset: 7,
		expected: 'aaa\nbbb\n\nccc\n'
	},
	{
		what: 'a paragraph cut at its end',
		source: 'aaa\nbbb\n',
		offset: 7,
		expected: 'aaa\nbbb\n\n\n'
	},
	{
		what: 'a two-line setext heading cut on its soft break',
		source: 'Title\nMore\n=====\n',
		offset: 5,
		expected: 'Title\n=====\nMore\n'
	},
	{
		what: 'a two-line setext heading cut just past its soft break',
		source: 'Title\nMore\n=====\n',
		offset: 6,
		expected: 'Title\n=====\nMore\n'
	},
	{
		what: 'a one-line setext heading cut at its content end',
		source: 'Title\n=====\n',
		offset: 5,
		expected: 'Title\n=====\n\n\n'
	},
	{
		what: 'an html block cut on the line ending after its opener',
		source: '<div>\nabc\n</div>\n',
		offset: 5,
		expected: '<div>\n\nabc\n</div>\n'
	}
];

describe('a split cutting on a line ending', () => {
	it.each(ROWS)('$what conserves every line', ({ source, offset, expected }) => {
		expect(splitBytes(source, offset)).toBe(expected);
	});

	it.each(ROWS)('$what conserves every line with CRLF endings', ({ source, offset, expected }) => {
		expect(splitBytes(crlf(source), crlfOffset(source, offset))).toBe(crlf(expected));
	});

	// A cut between the CR and the LF is the same cut: the ending is one boundary, and half of
	// it left on the first half is a stray CR the reload reads as content.
	it('a cut between the CR and the LF terminates the first half with the whole ending', () => {
		expect(splitBytes('aaa\r\nbbb\r\n', 4)).toBe('aaa\r\n\r\nbbb\r\n');
	});

	// The plural splice's own pin: a second half parsing to two blocks lands BOTH, so the
	// document holds three. Reds the moment the splice goes singular, and names why.
	it('a second half of two blocks splices both in', () => {
		const doc = parse('<div>\nabc\n</div>\n');
		splitNode(doc, 0, 5, undefined, undefined);
		expect(doc.children.length).toBe(3);
		expect(doc.children.map((c) => c.kind)).toEqual(['htmlBlock', 'paragraph', 'htmlBlock']);
		expect(serialize(doc)).toBe('<div>\n\nabc\n</div>\n');
	});
});
