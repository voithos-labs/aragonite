import fc from 'fast-check';
import type { InlineNode } from '../../../core/nodes';

// Inline fragments interleaved so the emphasis matcher, the code-span handler and the bracket
// stack see realistic adjacency. Images, `<br>` and decoding character references are left out:
// widgets break the textContent comparison (G2.4), and a decoded space shifts CommonMark's
// flanking. The conformance corpus, `test/core/inline/character-refs.test.ts` and
// `arbAltOnlyImage` below cover them.

// Non-ASCII words, because no node boundary may land inside a surrogate pair or a cluster.
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

/** A run nested in a run of the same kind, which the flat `emphasisRun` cannot reach. The asterisk
 *  spellings share one delimiter run, so a typed byte beside it can change which delimiters pair. */
const nestedRun = fc.constantFrom(
	'~~a ~b~ c~~',
	'_a _b_ c_',
	'*a *b* c*',
	'**a **b** c**',
	'**a *b** c*',
	'*a **b* c**',
	'***foo****foo*'
);

/** Runs that decline, and an autolink abutting the delimiters that would have taken it; both
 *  autolink grammars, since only the bare one's URL scanner absorbs a closing `*`. */
const decliningRun = fc.constantFrom('~~ a ~~', '_ a _', '*foo@bar.com*', '*www.example.com*');

// Generated rather than constant so the code-span×destination and paren/escape classes
// are reachable: backticks in either side, `)` inside a code span, balanced parens.
const inlineLink = fc
	.tuple(
		fc.constantFrom('text', 'a', '**bold**', '', 'x`y', 'foo@bar.com', 'https://x.co', 'www.x.co'),
		fc.constantFrom('url', 'u`x`', 'u`)`', 'a(b)c', 'u\\)', '<u v>', ''),
		fc.constantFrom('', ' "t"')
	)
	.map(([label, dest, title]) => `[${label}](${dest}${title})`);

const referenceLink = fc.constantFrom(
	'[label][ref]',
	'[collapsed][]',
	'[shortcut]',
	'[www.x.co][ref]'
);

const autolink = fc.constantFrom(
	'<https://example.com>',
	'https://example.com',
	'www.example.com',
	'foo@bar.com',
	'mailto:foo@bar.com',
	'xmpp:foo@bar.com/home',
	'<foo@bar.com>',
	// An open bracket before the address: only the email form links there.
	'[a www.example.com',
	'![https://example.com',
	'[foo@bar.com'
);

const escape = fc.constantFrom('\\*', '\\\\', '\\`', '\\[', '\\&', '\\!');

// Only the `&` scanner's decline forms, which stay flanking-neutral literal text in aragonite
// and commonmark alike.
const ampersandDecline = fc.constantFrom('&notreal;', '&');

const hardBreak = fc.constantFrom('\\\n', '\\\r\n', '  \n', '  \r\n');

// U+10100 (astral Po) spaces runs the way `.` does: flanking has to classify
// it by code points, not by UTF-16 units.
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

/** Biased toward emphasis flanking, nested delimiters and code/link/escape adjacency, so the
 *  offset and `textContent` properties test how the parser and the renderer interact. */
export const arbInlineSource = fc
	.array(fragment, { minLength: 1, maxLength: 12 })
	.map((parts) => parts.join(''));

// ── Hand-built images (the alt-only render path) ─────────────────────────────

/** An `image` node whose `alt` need not be a slice of its bytes, as a plugin's inline handler may
 *  build it; no source generator reaches this, since a parsed alt is read off its own label. */
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
