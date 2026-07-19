import fc from 'fast-check';

// Inline content fragments: emphasis/strong/strike runs, code spans, links,
// autolinks, escapes, entities, hard breaks, and plain words — interleaved so
// the emphasis matcher, code-span handler, and bracket stack all see realistic
// adjacency. Image and `<br>` fragments are excluded: they render as atomic
// widgets (0 textContent) and images expose a parsed `alt` that diverges from
// raw bytes, so the widget-free spine property (G2.4) and the offset partition
// (G2.5) stay clean. The widget-delta case in the spine test supplies those
// explicitly.

// Non-ASCII words (CJK, combining mark, emoji, ZWJ cluster) arm the properties
// against surrogate/cluster slicing: no node boundary may land mid-pair.
const word = fc.constantFrom(
	'foo',
	'bar',
	'baz',
	'x',
	'lorem',
	'42',
	'a',
	'b',
	'汉字',
	'ém',
	'😀',
	'👩‍👦'
);

const emphasisRun = fc
	.tuple(fc.constantFrom('*', '**', '_', '__', '~~', '***'), word)
	.map(([marker, inner]) => marker + inner + marker);

const codeSpan = fc
	.tuple(fc.constantFrom('`', '``'), fc.constantFrom('code', 'x = 1', 'a*b', '[x]', ''))
	.map(([ticks, inner]) => ticks + inner + ticks);

// Labels and destinations are generated (not constant strings) so the
// code-span×destination and paren/escape destination classes are reachable:
// backticks in either side, `)` inside a code span, balanced parens, `\)`.
const inlineLink = fc
	.tuple(
		fc.constantFrom('text', 'a', '**bold**', '', 'x`y'),
		fc.constantFrom('url', 'u`x`', 'u`)`', 'a(b)c', 'u\\)', '<u v>', ''),
		fc.constantFrom('', ' "t"')
	)
	.map(([label, dest, title]) => `[${label}](${dest}${title})`);

const referenceLink = fc.constantFrom('[label][ref]', '[collapsed][]', '[shortcut]');

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

// U+10100 (astral Po) spaces runs the way `.` does — flanking must classify
// it via code points, not UTF-16 units.
const punctSpacer = fc.constantFrom(' ', '. ', ', ', ' (', ') ', '!', '?', ': ', '', '\u{10100}');

const fragment = fc.oneof(
	{ arbitrary: word, weight: 5 },
	{ arbitrary: emphasisRun, weight: 4 },
	{ arbitrary: codeSpan, weight: 2 },
	{ arbitrary: inlineLink, weight: 2 },
	{ arbitrary: referenceLink, weight: 1 },
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
