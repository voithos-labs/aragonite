import { beforeEach, describe, expect, it } from 'vitest';
import { parse, serialize } from '#lib';
import { DEFINITION, footnotesGrammar } from '#lib/test/support/footnotes-grammar.js';

let grammar: ReturnType<typeof footnotesGrammar> | undefined;
const read = (src: string) => parse(src, { grammar });
const roundTrips = (src: string) => expect(serialize(read(src))).toBe(src);

describe('footnote round-trip in an editor listing footnotes', () => {
	beforeEach(() => {
		grammar = footnotesGrammar();
	});

	it('round-trips a single-line definition byte-for-byte', () => {
		roundTrips('[^1]: A single-line footnote.\n');
	});

	it('round-trips a multi-line definition, consuming the indented continuation into one block', () => {
		const src = '[^long]: First line of the note.\n    Continued, indented four spaces.\n';
		roundTrips(src);
		const doc = read(src);
		// The continuation is part of the definition, not a separate indented-code block.
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe(DEFINITION);
		expect(doc.children[0].raw).toBe(src);
	});

	it('round-trips a CRLF definition without normalizing the line ending', () => {
		roundTrips('[^win]: Windows line ending.\r\n    Continued.\r\n');
	});

	it('keeps a reference literal in surrounding prose (rendered as an inline widget, bytes intact)', () => {
		const src = 'See the note [^1] for details.\n\n[^1]: The detail.\n';
		roundTrips(src);
		// The blank line is the definition's leadingTrivia, not a third child.
		expect(read(src).children.map((c) => c.kind)).toEqual(['paragraph', DEFINITION]);
	});
});

describe('footnote round-trip for half-typed / incomplete syntax', () => {
	beforeEach(() => {
		grammar = footnotesGrammar();
	});

	it('leaves an unterminated reference literal (no parsed node to corrupt)', () => {
		// The reference needs a closing `]`, and the opener needs `]:`, so `[^` and `[^foo` never
		// match; they stay literal text and round-trip.
		for (const src of ['[^\n', '[^foo\n', 'A bare [^1] mark, no definition.\n']) {
			roundTrips(src);
			expect(read(src).children[0].kind).toBe('paragraph');
		}
	});

	it('claims an empty-body definition but declines an empty-label one', () => {
		roundTrips('[^1]:\n');
		expect(read('[^1]:\n').children[0].kind).toBe(DEFINITION);
		// Empty label: the opener's label group requires ≥1 char, so `[^]:` declines.
		roundTrips('[^]: body\n');
		expect(read('[^]: body\n').children[0].kind).toBe('paragraph');
	});
});

describe('footnote round-trip in an editor that leaves footnotes out', () => {
	beforeEach(() => {
		grammar = undefined;
	});

	it('falls back to a paragraph, and still round-trips', () => {
		// The built-in keeps leading-caret labels away from link reference definitions, so an
		// unlisted `[^label]:` line is a plain paragraph whose bytes survive verbatim.
		for (const src of ['[^1]: The detail.\n', '[^1]: https://example.com\n']) {
			roundTrips(src);
			expect(read(src).children[0].kind).toBe('paragraph');
		}
	});

	it('round-trips a full footnote document unchanged', () => {
		roundTrips('See the note [^1] here.\n\n[^1]: The detail.\n');
	});
});
