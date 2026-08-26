import fc from 'fast-check';
import type { InlineNode } from '../../../core/nodes';

// Inline fragments interleaved so the emphasis matcher, code-span handler, and bracket
// stack see realistic adjacency. Images, `<br>`, and ACCEPTING character references are
// excluded: they are widgets (breaking the widget-free G2.4 spine) or shift commonmark's
// flanking around a decoded space (a divergence the kind-differential oracle reports).
// Their coverage lives in the G2.11 conformance corpus,
// `test/core/inline/character-refs.test.ts`, and `arbAltOnlyImage` below.

// Non-ASCII words arm the properties against surrogate/cluster slicing: no node boundary
// may land mid-pair.
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
	'\u00e9m',
	'e\u0301m',
	'😀',
	'👩‍👦'
);

const emphasisRun = fc
	.tuple(fc.constantFrom('*', '**', '_', '__', '~', '~~', '***'), word)
	.map(([marker, inner]) => marker + inner + marker);

const codeSpan = fc
	.tuple(fc.constantFrom('`', '``'), fc.constantFrom('code', 'x = 1', 'a*b', '**', '[x]', ''))
	.map(([ticks, inner]) => ticks + inner + ticks);

/**
 * Nesting the flat `emphasisRun` cannot reach: a run inside a run of the SAME kind. Tilde and
 * underscore only — an ASTERISK nest rebinds under any neighbouring byte at every run length, which
 * the typing-seat net reads as its own failure. Those spellings live in the G2.14 display corpus,
 * which seats nothing.
 */
const nestedRun = fc.constantFrom('~~a ~b~ c~~', '_a _b_ c_');

/** Runs that decline, and a construct abutting the delimiters that would have taken them: a space
 *  inside the run kills its flanking, and an autolink's own bytes are no run's content. The BARE
 *  autolink is out for the asterisk nest's reason — its URL absorbs the closer. */
const decliningRun = fc.constantFrom('~~ a ~~', '_ a _', '*foo@bar.com*');

// Generated rather than constant so the code-span×destination and paren/escape classes
// are reachable: backticks in either side, `)` inside a code span, balanced parens.
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

// Only the `&` scanner's decline forms: both stay flanking-neutral literal text on
// aragonite and commonmark alike (see the header).
const ampersandDecline = fc.constantFrom('&notreal;', '&');

const hardBreak = fc.constantFrom('\\\n', '\\\r\n', '  \n', '  \r\n');

// U+10100 (astral Po) spaces runs the way `.` does — flanking must classify
// it via code points, not UTF-16 units.
const punctSpacer = fc.constantFrom(' ', '. ', ', ', ' (', ') ', '!', '?', ': ', '', '\u{10100}');

const fragment = fc.oneof(
	{ arbitrary: word, weight: 5 },
	{ arbitrary: emphasisRun, weight: 4 },
	{ arbitrary: nestedRun, weight: 2 },
	{ arbitrary: decliningRun, weight: 2 },
	{ arbitrary: codeSpan, weight: 2 },
	{ arbitrary: inlineLink, weight: 2 },
	{ arbitrary: referenceLink, weight: 1 },
	{ arbitrary: autolink, weight: 1 },
	{ arbitrary: escape, weight: 2 },
	{ arbitrary: ampersandDecline, weight: 2 },
	{ arbitrary: hardBreak, weight: 1 },
	{ arbitrary: punctSpacer, weight: 3 }
);

/**
 * Inline source string, biased toward emphasis flanking, nested delimiters, and
 * code/link/escape adjacency so the offset-partition and textContent-spine properties
 * exercise parser/renderer interaction rather than plain text. Exclusions: see the header.
 */
export const arbInlineSource = fc
	.array(fragment, { minLength: 1, maxLength: 12 })
	.map((parts) => parts.join(''));

// ── Minted images (the alt-only render path) ─────────────────────────────────

/**
 * An `image` node paired with the bytes it spans, minted the way an inline-syntax rung
 * mints one: `alt` need not be a slice of the node, or of the document, at all. No source
 * arbitrary reaches this, because a parsed alt is always read off its own label.
 */
export const arbAltOnlyImage = fc
	.record({
		lead: fc.constantFrom('', 'see ', '## '),
		open: fc.constantFrom('![', '![[', '!'),
		target: fc.constantFrom('cat.png', 'a', 'x y', '汉字.png', ''),
		close: fc.constantFrom('](u)', ']]', '|300]]', ']', ''),
		trail: fc.constantFrom('', ' tail'),
		// Pulls the node's end inside its own construct, so an alt read off the bytes can
		// outrun the span that owns it.
		shrink: fc.nat({ max: 3 }),
		altKind: fc.constantFrom('target', 'sourceRun', 'span', 'foreign', 'none')
	})
	.map(({ lead, open, target, close, trail, shrink, altKind }) => {
		const raw = lead + open + target + close + trail;
		const start = lead.length;
		const end = Math.max(start + 1, start + open.length + target.length + close.length - shrink);
		const alt = {
			target,
			// What a GFM-shaped read calls the alt: matches at the assumed opener, runs past.
			sourceRun: raw.slice(start + 2),
			span: raw.slice(start, end),
			foreign: 'elsewhere',
			none: undefined
		}[altKind];
		const node: InlineNode = {
			kind: 'image',
			start,
			end,
			children: [],
			url: target,
			...(alt !== undefined ? { alt } : {})
		};
		return { raw, node };
	});
