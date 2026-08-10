// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { buildLinkReferenceMap } from '$lib/core/inline/link-reference-resolver';
import {
	buildLinkWrapBytes,
	canWrapRangeAsLink
} from '$lib/components/blocks/text/link-source-bytes';

// The create half of the write seam: what `[selected text](url)` may be minted over, and how the
// selected bytes and the destination are escaped on the way. Declines are as pinned as wraps.

describe('link wrap bytes — minting a construct over plain text', () => {
	it('wraps the range and percent-encodes the destination stop characters', () => {
		expect(buildLinkWrapBytes('Alpha bravo charlie', 6, 11, 'https://x.test/a b(c)')).toBe(
			'[bravo](https://x.test/a%20b%28c%29)'
		);
	});

	it('escapes a bare bracket the selected text carries', () => {
		expect(buildLinkWrapBytes('take a ] here', 5, 8, 'u')).toBe('[a \\]](u)');
		expect(buildLinkWrapBytes('push [ it', 0, 9, 'u')).toBe('[push \\[ it](u)');
	});

	it('an unresolved bracket pair is plain text and wraps with both brackets escaped', () => {
		expect(buildLinkWrapBytes('see [hi] now', 4, 8, 'u')).toBe('[\\[hi\\]](u)');
	});

	it('an already-escaped bracket passes through without a second backslash', () => {
		expect(buildLinkWrapBytes('a \\[b\\] c', 0, 9, 'u')).toBe('[a \\[b\\] c](u)');
	});
});

describe('link wrap bytes — the seam declines rather than corrupt', () => {
	it('an empty or whitespace destination mints nothing: Escape must owe no cleanup', () => {
		expect(buildLinkWrapBytes('Alpha bravo charlie', 6, 11, '')).toBeNull();
		expect(buildLinkWrapBytes('Alpha bravo charlie', 6, 11, '   ')).toBeNull();
	});

	it.each([
		['crosses into a link', 2, 9],
		['contains the whole link', 0, 16],
		['sits inside the link text', 7, 8]
	])('a range that %s declines', (_name, start, end) => {
		expect(buildLinkWrapBytes('Visit [t](u) now', start, end, 'https://n.test')).toBeNull();
	});

	it('a range overlapping an inline code span declines', () => {
		expect(buildLinkWrapBytes('run `cmd` now', 2, 7, 'u')).toBeNull();
	});

	it('a bracket pair a definition turns into a shortcut-reference link declines', () => {
		const display = 'see [ref] now';
		const resolver = buildLinkReferenceMap(
			parse(`${display}\n\n[ref]: https://e.c\n`).children
		).resolve;
		expect(buildLinkWrapBytes(display, 4, 9, 'u', resolver)).toBeNull();
	});

	it('a neighbouring `!` that would turn the wrap into an image declines at verification', () => {
		expect(buildLinkWrapBytes('a !bang b', 3, 7, 'u')).toBeNull();
	});

	it('a collapsed or inverted range is never wrappable', () => {
		expect(canWrapRangeAsLink('Alpha bravo charlie', 6, 6)).toBe(false);
		expect(canWrapRangeAsLink('Alpha bravo charlie', 11, 6)).toBe(false);
	});
});
