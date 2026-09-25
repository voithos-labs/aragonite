// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { buildLinkReferenceMap } from '$lib/core/inline/link-reference-resolver';
import {
	buildLinkWrapBytes,
	canWrapRangeAsLink
} from '$lib/components/blocks/text/link-source-bytes';
import { fixtureReading } from '../../harness/fixture-grammar';

// The create half of the byte writer: what `[selected text](url)` may be written over, and how
// the selected bytes and the destination are escaped on the way. Refusals are covered as closely
// as wraps.

describe('link wrap bytes, creating a construct over plain text', () => {
	it('wraps the range and percent-encodes the destination stop characters', () => {
		expect(
			buildLinkWrapBytes('Alpha bravo charlie', 6, 11, 'https://x.test/a b(c)', fixtureReading())
		).toBe('[bravo](https://x.test/a%20b%28c%29)');
	});

	it('escapes a bare bracket the selected text carries', () => {
		expect(buildLinkWrapBytes('take a ] here', 5, 8, 'u', fixtureReading())).toBe('[a \\]](u)');
		expect(buildLinkWrapBytes('push [ it', 0, 9, 'u', fixtureReading())).toBe('[push \\[ it](u)');
	});

	it('an unresolved bracket pair is plain text and wraps with both brackets escaped', () => {
		expect(buildLinkWrapBytes('see [hi] now', 4, 8, 'u', fixtureReading())).toBe('[\\[hi\\]](u)');
	});

	it('an already-escaped bracket passes through without a second backslash', () => {
		expect(buildLinkWrapBytes('a \\[b\\] c', 0, 9, 'u', fixtureReading())).toBe('[a \\[b\\] c](u)');
	});
});

describe('link wrap bytes: the join declines rather than corrupt', () => {
	it('an empty or whitespace destination creates nothing: Escape leaves no cleanup', () => {
		expect(buildLinkWrapBytes('Alpha bravo charlie', 6, 11, '', fixtureReading())).toBeNull();
		expect(buildLinkWrapBytes('Alpha bravo charlie', 6, 11, '   ', fixtureReading())).toBeNull();
	});

	it.each([
		['crosses into a link', 2, 9],
		['contains the whole link', 0, 16],
		['sits inside the link text', 7, 8]
	])('a range that %s declines', (_name, start, end) => {
		expect(
			buildLinkWrapBytes('Visit [t](u) now', start, end, 'https://n.test', fixtureReading())
		).toBeNull();
	});

	it('a range overlapping an inline code span declines', () => {
		expect(buildLinkWrapBytes('run `cmd` now', 2, 7, 'u', fixtureReading())).toBeNull();
	});

	it('a bracket pair a definition turns into a shortcut-reference link declines', () => {
		const display = 'see [ref] now';
		const resolver = buildLinkReferenceMap(
			parse(`${display}\n\n[ref]: https://e.c\n`).children
		).resolve;
		expect(
			buildLinkWrapBytes(display, 4, 9, 'u', fixtureReading({ resolver: resolver }))
		).toBeNull();
	});

	it('a neighbouring `!` that would turn the wrap into an image declines at verification', () => {
		expect(buildLinkWrapBytes('a !bang b', 3, 7, 'u', fixtureReading())).toBeNull();
	});

	it('a collapsed or inverted range is never wrappable', () => {
		expect(canWrapRangeAsLink('Alpha bravo charlie', 6, 6, fixtureReading())).toBe(false);
		expect(canWrapRangeAsLink('Alpha bravo charlie', 11, 6, fixtureReading())).toBe(false);
	});
});
