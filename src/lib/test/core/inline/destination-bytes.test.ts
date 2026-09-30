// Miss-analysis: the writer's tests compared exact strings and never read the bytes back.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encodeDestination, escapeTitle } from '$lib/core/inline/destination-bytes';
import { parseLinkDestination, parseLinkTitle } from '$lib/core/inline/link-destination';
import {
	percentEncodeUri,
	processDestination,
	unescapeSpecString
} from '$lib/core/inline/scan/url';
import { parseInline } from '$lib/core/inline';
import { freshOrFixedSeed } from '../../invariants/arbitraries';

const PARAMS = { numRuns: 1000, seed: freshOrFixedSeed(617617) } as const;

// Source bytes heavy on what the grammar treats specially: escapes, entities, quotes, parens.
const arbSource = fc
	.array(
		fc.constantFrom(
			'&',
			'&amp;',
			'&copy;',
			'&#35;',
			'&#x41;',
			'\\',
			'\\&',
			'"',
			"'",
			'(',
			')',
			'<',
			'>',
			';',
			'#',
			'%',
			'%20',
			' ',
			'a',
			'é',
			'copy'
		),
		{ maxLength: 12 }
	)
	.map((parts) => parts.join(''));

function readTitle(value: string): string | undefined {
	const bytes = `"${escapeTitle(value)}"`;
	return parseLinkTitle(bytes, 0, bytes.length)?.title;
}

function readDestination(value: string): string | undefined {
	// The `)` an inline link closes on, which lets an empty destination read.
	const bytes = encodeDestination(value) + ')';
	return parseLinkDestination(bytes, 0, bytes.length)?.url;
}

describe('the destination and title writers read back through the link grammar', () => {
	it('a title value survives a write and a read', () => {
		fc.assert(
			fc.property(arbSource.map(unescapeSpecString), (value) => readTitle(value) === value),
			PARAMS
		);
	});

	it('a destination value survives a write and a read', () => {
		fc.assert(
			fc.property(arbSource.map(processDestination), (value) => readDestination(value) === value),
			PARAMS
		);
	});

	// A url typed into the link card reads back percent-encoded, as `readDestination` returns it.
	it('any destination text reads back as the reader would encode it', () => {
		fc.assert(
			fc.property(arbSource, (text) => readDestination(text) === percentEncodeUri(text)),
			PARAMS
		);
	});

	it('balanced parentheses stay as written, and unbalanced ones are escaped', () => {
		expect(encodeDestination('/wiki/Foo_(bar)')).toBe('/wiki/Foo_(bar)');
		expect(encodeDestination('a)b(c')).toBe('a\\)b\\(c');
		expect(encodeDestination('a(b')).toBe('a\\(b');
	});

	it('a title holding entity text keeps it as text', () => {
		expect(readTitle('&copy;')).toBe('&copy;');
		expect(readTitle('a &amp; b')).toBe('a &amp; b');
	});

	it('a destination holding entity text keeps it as text', () => {
		expect(readDestination('/a?b&copy;')).toBe('/a?b&copy;');
	});

	it('a bare ampersand is written as it is', () => {
		expect(escapeTitle('A & B')).toBe('A & B');
		expect(encodeDestination('/a?b=1&c=2')).toBe('/a?b=1&c=2');
	});

	it('a whole link written from a title read off `&amp;copy;` renders that title', () => {
		const title = parseInline('[x](/u "&amp;copy;")', 0, 20)[0].title!;
		const rewritten = `[x](/u "${escapeTitle(title)}")`;
		expect(parseInline(rewritten, 0, rewritten.length)[0].title).toBe('&copy;');
	});
});
