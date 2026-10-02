// A cut on a line ending terminates the first half with that ending, so the second half doesn't
// open with a blank line and lose every line past the cut on reparse.
// Miss-analysis: GH #95, the split suite asserted each half's raw, never the document's bytes.

import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { splitNode } from '../../tree-operations';
import { describeConvergence } from '../harness/parse-converged';
import { fixtureReading } from '../harness/fixture-grammar';
import { createSharingState } from '$lib/tree-operations/sharing';

/**
 * The document's bytes, since per-half raws can't show a dropped block; the shape must also reload
 * as itself, or the loss returns on remount.
 */
function splitBytes(source: string, offset: number): string {
	const doc = parse(source);
	splitNode(doc, 0, offset, createSharingState(), fixtureReading());
	expect(describeConvergence(doc), `${JSON.stringify(source)} @${offset}`).toBeNull();
	return serialize(doc);
}

/** The CRLF counterpart's cut: each ending crossed is two bytes there rather than one (G4.20). */
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

	// A second half parsing to two blocks lands both, so the document holds three.
	it('a second half of two blocks splices both in', () => {
		const doc = parse('<div>\nabc\n</div>\n');
		splitNode(doc, 0, 5, createSharingState(), fixtureReading());
		expect(doc.children.length).toBe(3);
		expect(doc.children.map((c) => c.kind)).toEqual(['htmlBlock', 'paragraph', 'htmlBlock']);
		expect(serialize(doc)).toBe('<div>\n\nabc\n</div>\n');
	});
});
