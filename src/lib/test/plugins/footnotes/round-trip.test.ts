import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPlugins, parse, serialize } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { footnotesPlugin, FOOTNOTE_DEF_KIND } from '$lib/plugins/footnotes';

const roundTrips = (src: string) => expect(serialize(parse(src))).toBe(src);

describe('footnote round-trip with the plugin installed', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([footnotesPlugin()]);
	});

	it('round-trips a single-line definition byte-for-byte', () => {
		roundTrips('[^1]: A single-line footnote.\n');
	});

	it('round-trips a multi-line definition, consuming the indented continuation into one block', () => {
		const src = '[^long]: First line of the note.\n    Continued, indented four spaces.\n';
		roundTrips(src);
		const doc = parse(src);
		// The continuation is part of the definition, not a separate indented-code block.
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe(FOOTNOTE_DEF_KIND);
		expect(doc.children[0].raw).toBe(src);
	});

	it('round-trips a CRLF definition without normalizing the line ending', () => {
		roundTrips('[^win]: Windows line ending.\r\n    Continued.\r\n');
	});

	it('keeps a reference literal in surrounding prose (it is not a CST node)', () => {
		const src = 'See the note [^1] for details.\n\n[^1]: The detail.\n';
		roundTrips(src);
		const doc = parse(src);
		// The blank line is the definition's leadingTrivia, not a third child.
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', FOOTNOTE_DEF_KIND]);
	});
});

describe('footnote round-trip for half-typed / incomplete syntax (plugin installed)', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([footnotesPlugin()]);
	});

	it('leaves an unterminated reference literal (no parsed node to corrupt)', () => {
		// The reference decoration needs a closing `]`, and the opener needs `]:`, so
		// `[^` / `[^foo` are never claimed — they stay literal text and round-trip.
		for (const src of ['[^\n', '[^foo\n', 'A bare [^1] mark, no definition.\n']) {
			roundTrips(src);
			expect(parse(src).children[0].kind).toBe('paragraph');
		}
	});

	it('claims an empty-body definition but declines an empty-label one', () => {
		roundTrips('[^1]:\n');
		expect(parse('[^1]:\n').children[0].kind).toBe(FOOTNOTE_DEF_KIND);
		// Empty label: the opener's label group requires ≥1 char, so `[^]:` declines.
		roundTrips('[^]: body\n');
		expect(parse('[^]: body\n').children[0].kind).toBe('paragraph');
	});
});

describe('footnote round-trip without the plugin (the uninstall story)', () => {
	afterEach(() => resetPluginPlatformForTests());

	beforeEach(() => {
		// Reset to built-ins only — do NOT install the plugin. A document authored
		// with footnotes must survive being opened by an editor that lacks them.
		resetPluginPlatformForTests();
	});

	it('falls back to a paragraph when uninstalled — and still round-trips', () => {
		// The built-in reserves leading-caret labels away from link reference
		// definitions, so an uninstalled [^label]: line is a plain paragraph — for
		// both prose and URL bodies. Either way the bytes survive verbatim.
		for (const src of ['[^1]: The detail.\n', '[^1]: https://example.com\n']) {
			roundTrips(src);
			expect(parse(src).children[0].kind).toBe('paragraph');
		}
	});

	it('round-trips a full footnote document unchanged', () => {
		roundTrips('See the note [^1] here.\n\n[^1]: The detail.\n');
	});
});
