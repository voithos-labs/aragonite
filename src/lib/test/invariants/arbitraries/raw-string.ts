import fc from 'fast-check';

// ── Markdown-significant fragments ──────────────────────────────────────────

const markers = '#*_~`>-+|[]()!\\&;'.split('');

const lineEndings = ['\n', '\r\n', '\r'];

const entities = ['&copy;', '&amp;', '&lt;', '&#39;', '&#x22;', '&notreal;', '&', '&#', '&#x'];

const escapes = ['\\*', '\\\\', '\\`', '\\[', '\\]', '\\!', '\\', '\\&'];

const whitespaceRuns = ['', ' ', '  ', '\t', ' \t ', '   '];

// Lazy-continuation blockquote shapes: a marker line followed by a bare
// continuation the parser must absorb without re-deriving the prefix. The
// indents straddle the CommonMark block-indent boundary deliberately — up to
// three spaces the marker still opens a quote, at four the line is indented
// code and the `>` is content, and a tab counts as four columns. The vocabulary
// stopped at three spaces, so the boundary itself was never crossed.
const lazyQuoteShapes = [
	'> ',
	'>',
	'> > ',
	'>> ',
	'   > ',
	'> \n',
	'>\tlazy',
	'    > ',
	'\t> ',
	'     > ',
	'  \t> ',
	'    - ',
	'\t- ',
	'    1. ',
	'    # '
];

const arbFragment = fc.oneof(
	{ arbitrary: fc.string({ unit: 'binary', maxLength: 8 }), weight: 3 },
	{ arbitrary: fc.constantFrom(...markers), weight: 4 },
	{ arbitrary: fc.constantFrom(...lineEndings), weight: 3 },
	{ arbitrary: fc.constantFrom(...entities), weight: 2 },
	{ arbitrary: fc.constantFrom(...escapes), weight: 2 },
	{ arbitrary: fc.constantFrom(...whitespaceRuns), weight: 2 },
	{ arbitrary: fc.constantFrom(...lazyQuoteShapes), weight: 2 }
);

// ── Public arbitraries ──────────────────────────────────────────────────────

/**
 * Garbage source biased toward markdown-significant content: random unicode,
 * markers, mixed CR/LF/CRLF, entities, escapes, lazy-quote shapes. Round-trip
 * must hold byte-for-byte regardless of how this parses.
 */
export const arbRawString = fc.array(arbFragment, { maxLength: 40 }).map((parts) => parts.join(''));

/** CRLF-heavy source: mixed CR, LF, CRLF and lone \r interleaved with content. */
export const arbCrlfString = fc
	.array(
		fc.oneof(
			fc.constantFrom('\n', '\r\n', '\r', '\r\r', '\n\r'),
			fc.string({ unit: 'grapheme-ascii', maxLength: 6 }),
			fc.constantFrom(...markers)
		),
		{ maxLength: 30 }
	)
	.map((parts) => parts.join(''));

/** Deeply nested container prefixes (blockquote / list) to stress prefix re-derivation. */
export const arbDeepNesting = fc
	.array(
		fc.tuple(
			fc.constantFrom(
				'> ',
				'>',
				'  - ',
				'- ',
				'1. ',
				'   > ',
				'\t',
				'    ',
				'    > ',
				'\t> ',
				'\t\t- ',
				'     1. '
			),
			fc.string({ unit: 'grapheme-ascii', maxLength: 8 })
		),
		{ minLength: 1, maxLength: 12 }
	)
	.map((rows) => rows.map(([prefix, body]) => prefix + body).join('\n') + '\n');
