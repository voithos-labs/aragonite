import fc from 'fast-check';
import { arbInlineSource } from './inline';
import { arbGfmDoc, nonAsciiWord } from './gfm';
import { withDrawnLineEnding } from './line-endings';

/**
 * Source fragments for the grammars the bundled plugins add. No built-in generator emits any of
 * them, so plugin scanner and opener code would otherwise sit outside the property suites. Drawn
 * without the matching plugin installed, the text parses as prose, which is itself the case where
 * the two have to coexist.
 */

// ── Inline syntax handlers ───────────────────────────────────────────────────

/**
 * Tokens that reach each handler's claim and its decline: the bare-trigger paths a well-formed
 * token never takes, and the places where a handler disturbs a neighbour's scan. The non-ASCII
 * cases are the offset-arithmetic ones, since each handler slices its own label out of the raw.
 */
const asciiRungToken = fc.constantFrom(
	'[^1]',
	'[^note]',
	'[^',
	'[^]',
	':smile:',
	':+1:',
	':',
	'::',
	':not-an-emoji:',
	'$x$',
	'$a_b$',
	// A digit body and a price standing ahead of a formula: the shapes where `$` recognition
	// decides how far a claim reaches, and so where it can overlap the token beside it.
	'$5$',
	'$9 and $x$',
	'$',
	'$$',
	'~sub~',
	'~~strike~~'
);

/** The same token shapes carrying a multi-unit label, which is where each handler's own slice of
 *  the raw either counts scalars or cuts one in half. */
const nonAsciiRungToken = nonAsciiWord.chain((word) =>
	fc.constantFrom(`[^${word}]`, `:${word}:`, `$${word}$`, `~${word}~`)
);

// The minority case, at a rate that reaches every handler without spending all the bytes on the
// same offset-arithmetic class: a plugin token is short, so a multi-unit label is most of it.
const inlineRungToken = fc.oneof(
	{ arbitrary: asciiRungToken, weight: 6 },
	{ arbitrary: nonAsciiRungToken, weight: 1 }
);

/** Plugin tokens interleaved with adversarial built-in inline content. */
export const arbPluginInlineSource = fc
	.array(
		fc.oneof({ arbitrary: arbInlineSource, weight: 2 }, { arbitrary: inlineRungToken, weight: 3 }),
		{
			minLength: 1,
			maxLength: 6
		}
	)
	.map((parts) => parts.join(''));

/**
 * The plugin tokens on their own, with no built-in inline content around them.
 * `arbPluginInlineSource` mixes `arbInlineSource` in, so a minimum read off it could be met
 * entirely by the built-in half.
 */
export const arbPluginInlineToken = fc
	.array(inlineRungToken, { minLength: 1, maxLength: 6 })
	.map((parts) => parts.join(''));

// ── Block openers ────────────────────────────────────────────────────────────

const footnoteDefinition = fc
	.tuple(
		fc.oneof(fc.constantFrom('1', 'note', 'a b'), nonAsciiWord),
		fc.oneof(fc.constantFrom('text', 'more words', ''), nonAsciiWord)
	)
	.map(([label, body]) => `[^${label}]: ${body}\n`);

const mathFence = fc
	.tuple(
		fc.constantFrom('$$', '$$math'),
		fc.array(fc.oneof(fc.constantFrom('x = 1', '\\frac{a}{b}', ''), nonAsciiWord), { maxLength: 3 })
	)
	.map(([open, body]) => open + '\n' + body.map((l) => l + '\n').join('') + '$$\n');

const githubAlert = fc
	.tuple(
		fc.constantFrom('NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION', 'BOGUS'),
		fc.array(fc.oneof(fc.constantFrom('body', 'more', ''), nonAsciiWord), { maxLength: 2 })
	)
	.map(
		([type, body]) => `> [!${type}]\n` + body.map((l) => (l === '' ? '>\n' : `> ${l}\n`)).join('')
	);

const directive = fc
	.tuple(
		fc.constantFrom(':::', '::::'),
		// The name charset is ASCII by grammar; the non-ASCII dimension is the body's.
		fc.constantFrom('note', 'callout', 'unknown-name', ''),
		fc.array(fc.oneof(fc.constantFrom('inner', '', '# heading'), nonAsciiWord), { maxLength: 2 })
	)
	.map(
		([fence, name, body]) => fence + name + '\n' + body.map((l) => l + '\n').join('') + fence + '\n'
	);

/**
 * The four plugin block grammars alone, each with its own drawn line ending. The ending is a
 * per-construct draw rather than a document-level one so a CRLF footnote can sit beside an LF
 * math fence, which is the shape a mixed-ending paste produces.
 */
export const arbPluginBlockSource = withDrawnLineEnding(
	fc.oneof(
		{ arbitrary: footnoteDefinition, weight: 2 },
		{ arbitrary: mathFence, weight: 1 },
		{ arbitrary: githubAlert, weight: 2 },
		{ arbitrary: directive, weight: 2 }
	)
);

/**
 * A GFM document with plugin block syntax mixed in. The unterminated and malformed cases carry
 * the weight: an opener that wrongly declines still has to leave the refused bytes as authored.
 */
export const arbPluginGfmDoc = fc
	.array(
		fc.oneof(
			{ arbitrary: arbGfmDoc, weight: 2 },
			{ arbitrary: arbPluginBlockSource, weight: 7 },
			{ arbitrary: arbPluginInlineSource.map((s) => s + '\n'), weight: 2 }
		),
		{ minLength: 1, maxLength: 6 }
	)
	.map((blocks) => blocks.join(''));
