import fc from 'fast-check';
import { withDrawnLineEnding } from './line-endings';

/**
 * The characters live mode's hidden edges are made of. `inline.ts` leans toward the emphasis
 * matcher; this leans toward the shapes `docs/design/live-mode.md` § 4 is about: markers that
 * paint, delimiter runs shared between a nested pair, and constructs a cut cannot reopen.
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
 * Runs of three or more asterisks, where one run serves two constructs at once. Both the caret
 * placement and the join cleaner have to choose which pair a byte belongs to.
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

/** Links and images, including the two that paint their own markers (§ 4.1). */
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

/** A childless construct between two literal delimiter runs: deleting it merges the runs, and a
 *  long enough run opens a fence that swallows every block below it on reload. */
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

/** Childless constructs a cut cannot reopen: two halves of a URL are not two URLs. */
const neverExtend = fc.constantFrom(
	'<https://example.com>',
	'<a@b.com>',
	'https://example.com',
	'mailto:a@b.com',
	'xmpp:a@b.com/r',
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

/** The block's own markers, which set where its content range starts: a heading's prefix and a
 *  quote marker are the two that gestures have to stay on the content side of. */
const blockPrefix = fc.constantFrom('', '', '', '## ', '> ', '- ');

/** Trailing whitespace is the one run a live split may legitimately drop. */
const blockSuffix = fc.constantFrom('', '', '  ', ' ');

const arbLiveBlock = fc
	.tuple(blockPrefix, arbLiveInlineSource, blockSuffix)
	.map(([prefix, body, suffix]) => prefix + body + suffix);

/**
 * A multi-block document with blank separators: the gestures that cross a block boundary (a merge,
 * a cross-block range delete) need two prose leaves and a join between them.
 */
export const arbLiveDoc = withDrawnLineEnding(
	fc.array(arbLiveBlock, { minLength: 1, maxLength: 3 }).map((blocks) => blocks.join('\n\n') + '\n')
);
