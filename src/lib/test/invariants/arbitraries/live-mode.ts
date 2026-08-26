import fc from 'fast-check';
import { withDrawnLineEnding } from './line-endings';

/**
 * The alphabet live mode's hidden edges are made of. `inline.ts` biases toward the emphasis
 * matcher; this biases toward the shapes § 4's rules are ABOUT — chrome that paints, delimiter runs
 * shared between a nested pair, and constructs a cut cannot reopen.
 */

// ── Inline fragments ─────────────────────────────────────────────────────────

const word = fc.constantFrom(
	'foo',
	'bar',
	'x',
	'a',
	'lorem',
	'42',
	'汉字',
	'\u00e9m',
	'e\u0301m',
	'😀',
	'👩‍👦'
);

/** Symmetric pairs, nested one deep: the chain a split closes and reopens innermost-first. */
const symmetricPair = fc.constantFrom(
	'**a**',
	'*a*',
	'~~a~~',
	'`a`',
	'__a__',
	'**a *b* c**',
	'*a **b** c*',
	'~~a `b` c~~',
	'**a ~~b~~ c**',
	'*a `b` **c***'
);

/**
 * Runs of three or more asterisks, where one run serves two constructs at once. The seat and the
 * join cleaner both have to choose which pair a byte belongs to, which is #116's and #136's family.
 */
const sharedRun = fc.constantFrom(
	'***a***',
	'***foo****foo*',
	'*****a*****',
	'**a***b*',
	'*a***b**',
	'***a**b*',
	'[**bold**](url)***foo***foo'
);

/** Links and images, including the two that paint their own chrome (§ 4.1). */
const bracketed = fc.constantFrom(
	'[a](u)',
	'[](u)',
	'**[](u)**',
	'*[](u)*',
	'~~[](u)~~',
	'[**b**](u)',
	'![](u)',
	'![alt](u)',
	'**![](u)**',
	'[a][ref]',
	'[shortcut]'
);

/**
 * A childless construct standing between two LITERAL delimiter runs. Taking it whole abuts the runs
 * into one, and a long enough run is another BLOCK's opener — a tilde or backtick fence, which on
 * reload swallows every block below it. The class a seam verifying its candidate as inline text
 * cannot see, so no draw without these shapes reaches it.
 */
const abuttingRuns = fc.constantFrom(
	'~~[](u)~~a',
	'~~[](u)~~ x',
	'~~~[](u)~~~b',
	'``[](u)``x',
	'~~![](u)~~b',
	'**[](u)**a',
	'*.****',
	'~~\\*[](u)~~c'
);

/** Childless constructs a cut cannot reopen: two halves of a URL are not two URLs (#118). */
const neverExtend = fc.constantFrom(
	'<https://example.com>',
	'<a@b.com>',
	'https://example.com',
	'\\*',
	'\\\\',
	'\\[',
	'\\&'
);

const entity = fc.constantFrom('&amp;', '&copy;', '&notreal;', '&');

const spacer = fc.constantFrom(' ', '. ', ', ', ' (', ') ', '');

const fragment = fc.oneof(
	{ arbitrary: word, weight: 4 },
	{ arbitrary: symmetricPair, weight: 4 },
	{ arbitrary: sharedRun, weight: 3 },
	{ arbitrary: bracketed, weight: 4 },
	{ arbitrary: abuttingRuns, weight: 3 },
	{ arbitrary: neverExtend, weight: 2 },
	{ arbitrary: entity, weight: 1 },
	{ arbitrary: spacer, weight: 3 }
);

/** One line of live-mode-adversarial inline source. */
export const arbLiveInlineSource = fc
	.array(fragment, { minLength: 1, maxLength: 6 })
	.map((parts) => parts.join(''));

// ── Blocks ───────────────────────────────────────────────────────────────────

/** The block's own chrome, which sets where its content range starts — a heading's prefix and a
 *  quote marker are the two the gesture seams have to stay content-side of. */
const blockPrefix = fc.constantFrom('', '', '', '## ', '> ', '- ');

/** Terminal whitespace is the one run a live split may legitimately drop (#106). */
const blockSuffix = fc.constantFrom('', '', '  ', ' ');

const arbLiveBlock = fc
	.tuple(blockPrefix, arbLiveInlineSource, blockSuffix)
	.map(([prefix, body, suffix]) => prefix + body + suffix);

/**
 * A multi-block document with blank separators: the gestures that cross a block boundary (a merge,
 * a cross-block range delete) need two prose leaves and a seam between them.
 */
export const arbLiveDoc = withDrawnLineEnding(
	fc.array(arbLiveBlock, { minLength: 1, maxLength: 3 }).map((blocks) => blocks.join('\n\n') + '\n')
);
