import fc from 'fast-check';

// Inline content fragments: emphasis/strong/strike runs, code spans, links,
// autolinks, escapes, entities, hard breaks, and plain words — interleaved so
// the emphasis matcher, code-span pre-pass, and link scanner all see realistic
// adjacency. Image and `<br>` fragments are excluded: they render as atomic
// widgets (0 textContent) and images expose a parsed `alt` that diverges from
// raw bytes, so the widget-free spine property (G2.4) and the offset partition
// (G2.5) stay clean. The widget-delta case in the spine test supplies those
// explicitly.

const word = fc.constantFrom('foo', 'bar', 'baz', 'x', 'lorem', '42', 'a', 'b');

const emphasisRun = fc
	.tuple(fc.constantFrom('*', '**', '_', '__', '~~', '***'), word)
	.map(([marker, inner]) => marker + inner + marker);

const codeSpan = fc
	.tuple(fc.constantFrom('`', '``'), fc.constantFrom('code', 'x = 1', 'a*b', '[x]', ''))
	.map(([ticks, inner]) => ticks + inner + ticks);

const inlineLink = fc.constantFrom(
	'[text](url)',
	'[a](b "t")',
	'[**bold**](u)',
	'[](u)',
	'[label][ref]',
	'[collapsed][]',
	'[shortcut]'
);

const autolink = fc.constantFrom(
	'<https://example.com>',
	'https://example.com',
	'www.example.com',
	'foo@bar.com',
	'<foo@bar.com>'
);

const escape = fc.constantFrom('\\*', '\\\\', '\\`', '\\[', '\\&', '\\!');

const entity = fc.constantFrom('&copy;', '&amp;', '&#39;', '&#x22;', '&notreal;', '&');

// Hard breaks: backslash-newline and two-spaces-newline, both LF and CRLF.
const hardBreak = fc.constantFrom('\\\n', '\\\r\n', '  \n', '  \r\n');

const punctSpacer = fc.constantFrom(' ', '. ', ', ', ' (', ') ', '!', '?', ': ', '');

const fragment = fc.oneof(
	{ arbitrary: word, weight: 5 },
	{ arbitrary: emphasisRun, weight: 4 },
	{ arbitrary: codeSpan, weight: 2 },
	{ arbitrary: inlineLink, weight: 2 },
	{ arbitrary: autolink, weight: 1 },
	{ arbitrary: escape, weight: 2 },
	{ arbitrary: entity, weight: 2 },
	{ arbitrary: hardBreak, weight: 1 },
	{ arbitrary: punctSpacer, weight: 3 }
);

/**
 * Inline source string (no block syntax, no images / `<br>` widgets). Biased
 * toward emphasis flanking, nested delimiters, and code/link/escape adjacency
 * so the offset-partition and textContent-spine properties exercise the parser
 * and renderer interactions, not just plain text.
 */
export const arbInlineSource = fc
	.array(fragment, { minLength: 1, maxLength: 12 })
	.map((parts) => parts.join(''));
