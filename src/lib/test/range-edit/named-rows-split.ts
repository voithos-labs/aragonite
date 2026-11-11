// Named rows for a paste that puts a block boundary in a block's text: the block is cut there as
// Enter cuts it. A heading keeps its underline or closing `#` run on the half that stays its line,
// and in live mode a format run the cut goes through closes above and reopens below. The last
// rows hold a to-do's first line, whose own write every such paste goes through.

import type { Gesture } from '#lib/range-edit/edit-range.js';
import type { NamedRow } from './named-rows';

const paste = (t: string): Gesture => ({ paste: t, plain: false, holds: 'text' });
const plain = (t: string): Gesture => ({ paste: t, plain: true, holds: 'text' });
const TABLE = '| a |\n| - |';
const FENCE = '```\nx\n```';

/** One row per mode, for bytes both modes share. */
const both = (name: string, source: string, gesture: Gesture, out: string): NamedRow[] => [
	{ name, source, gesture, expect: { source: out } },
	{ name: `${name}, live`, source, mode: 'live', gesture, expect: { source: out } }
];
const live = (name: string, source: string, gesture: Gesture, out: string): NamedRow => ({
	name: `live, ${name}`,
	source,
	mode: 'live',
	gesture,
	expect: { source: out }
});

// Miss-analysis: every paste row at a heading used an ATX heading with no closing run, and the
// drawn setext headings met law 9 only where its expectation moved the underline too.
const STRUCTURE_ROWS: NamedRow[] = [
	...both(
		'S a line ending pasted at a setext title’s end lands under the underline',
		'Title⟦⟧\n===\n',
		paste('x\n'),
		'Titlex\n===\n\n'
	),
	...both('S a line ending alone does the same', 'Title⟦⟧\n===\n', paste('\n'), 'Title\n===\n\n'),
	...both(
		'S two paragraphs at a setext title’s end: the first joins it above the underline',
		'Title⟦⟧\n===\n',
		paste('one\n\ntwo'),
		'Titleone\n===\n\ntwo\n'
	),
	...both(
		'S a table at a setext title’s end lands under the underline',
		'Title⟦⟧\n===\n',
		paste(TABLE),
		'Title\n===\n\n| a |\n| - |\n'
	),
	...both('S and a fence', 'Title⟦⟧\n===\n', paste(FENCE), 'Title\n===\n\n```\nx\n```\n'),
	...both(
		'S two paragraphs mid-title: the underline stays with the first half',
		'Ti⟦⟧tle\n===\n',
		paste('one\n\ntwo'),
		'Tione\n===\n\ntwotle\n'
	),
	...both(
		'S a table mid-title',
		'Ti⟦⟧tle\n===\n',
		paste(TABLE),
		'Ti\n===\n\n| a |\n| - |\n\ntle\n'
	),
	...both(
		'S a line pasted mid-title is a line of the title',
		'Ti⟦⟧tle\n===\n',
		paste('x\n'),
		'Tix\ntle\n===\n'
	),
	...both(
		'S two paragraphs at a setext title’s start: the first is the heading',
		'⟦⟧Title\n===\n',
		paste('one\n\ntwo'),
		'one\n===\n\ntwoTitle\n'
	),
	...both(
		'S a table at a setext title’s start lands above the whole heading',
		'⟦⟧Title\n===\n',
		paste(TABLE),
		'| a |\n| - |\n\nTitle\n===\n'
	),
	...both(
		'S a line and its ending over a setext title’s whole text',
		'⟦Title⟧\n===\n',
		paste('x\n'),
		'x\n===\n\n'
	),
	...both(
		'S two paragraphs over a setext title’s whole text keep it a heading',
		'⟦Title⟧\n===\n',
		paste('one\n\ntwo'),
		'one\n===\n\ntwo\n'
	),
	...both('S a title left blank loses its underline', '⟦Title⟧\n===\n', paste(' '), ' \n'),
	...both(
		'S in a quote the underline keeps its marker',
		'> Ti⟦⟧tle\n> ===\n',
		paste('one\n\ntwo'),
		'> Tione\n> ===\n>\n> twotle\n'
	),
	...both('S CRLF', 'Ti⟦⟧tle\r\n===\r\n', paste('one\n\ntwo'), 'Tione\r\n===\r\n\r\ntwotle\r\n'),
	{
		name: 'S plain text with a blank line cuts the same way',
		source: 'Ti⟦⟧tle\n===\n',
		gesture: plain('one\n\ntwo'),
		expect: { source: 'Tione\n===\n\ntwotle\n' }
	},
	...both(
		'S a line ending pasted before a closing run lands under the heading',
		'# Title⟦⟧ #\n',
		paste('x\n'),
		'# Titlex #\n\n'
	),
	...both(
		'S two paragraphs before a closing run',
		'# Title⟦⟧ #\n',
		paste('one\n\ntwo'),
		'# Titleone #\n\ntwo\n'
	),
	...both(
		'S a table before a closing run',
		'# Title⟦⟧ #\n',
		paste(TABLE),
		'# Title #\n\n| a |\n| - |\n'
	),
	...both(
		'S two paragraphs mid-heading: the closing run stays on the heading',
		'# Ti⟦⟧tle #\n',
		paste('one\n\ntwo'),
		'# Tione #\n\ntwotle\n'
	),
	...both(
		'S a table mid-heading',
		'# Ti⟦⟧tle #\n',
		paste(TABLE),
		'# Ti #\n\n| a |\n| - |\n\ntle\n'
	),
	...both(
		'S a line pasted mid-heading splits a heading that holds one line',
		'# Ti⟦⟧tle #\n',
		paste('x\n'),
		'# Tix #\ntle\n'
	),
	...both(
		'S two paragraphs at a heading’s text start keep the run beside its marker',
		'# ⟦⟧Title #\n',
		paste('one\n\ntwo'),
		'# one #\n\ntwoTitle\n'
	),
	...both(
		'S two paragraphs over a heading’s whole text keep its closing run',
		'# ⟦Title⟧ #\n',
		paste('one\n\ntwo'),
		'# one #\n\ntwo\n'
	),
	...both(
		'S a list of the other kind mid-heading in an item',
		'- # Ti⟦⟧tle #\n',
		paste('1. q\n2. r'),
		'- # Ti #\n1. q\n2. r\n- tle\n'
	)
];

// Miss-analysis: ruling 17 kept an emptied heading above the pasted blocks with no mounted answer
// to compare; today's editor lets the blocks take its line, and a setext heading can't stay empty.
const EMPTIED_ROWS: NamedRow[] = [
	...both(
		'E blocks that join no text take an emptied heading’s line',
		'# ⟦⟧\n',
		paste('> q'),
		'> q\n'
	),
	...both('E over a heading’s whole text', '# ⟦Title⟧\n', paste('> q\n\nafter'), '> q\n\nafter\n'),
	...both('E its closing run goes with it', '# ⟦Title⟧ #\n', paste('> q'), '> q\n'),
	...both('E a table', '# ⟦Title⟧ #\n', paste(TABLE), '| a |\n| - |\n'),
	...both(
		'E the blocks land as on an empty line, apart from a line that would re-read them',
		'# ⟦h⟧\n---\n',
		paste('> q\n\nafter'),
		'> q\n\nafter\n\n---\n'
	),
	...both('E a setext heading’s underline goes with it', '⟦Title⟧\n===\n', paste('> q'), '> q\n'),
	...both('E and under a table', '⟦Title⟧\n===\n', paste(TABLE), '| a |\n| - |\n'),
	...both(
		'E a heading that keeps text after the caret stays under the pasted block',
		'# ⟦Ti⟧tle\n',
		paste('> q'),
		'> q\n# tle\n'
	),
	...both(
		'E a clipboard opening with a blank line moves the heading down with its text',
		'# ⟦⟧Hi\n',
		paste('\n\ntwo'),
		'\n\n# twoHi\n'
	),
	...both(
		'E text that joins keeps the heading',
		'# ⟦Title⟧\n',
		paste('one\n\ntwo'),
		'# one\n\ntwo\n'
	)
];

// Miss-analysis: law 5 strips delimiters before it compares, and every live paste row landed its
// blocks over a range, so no row or law saw a caret inside a run leave both halves open.
const RUN_ROWS: NamedRow[] = [
	{
		name: 'live, two paragraphs in a bold run close it above and reopen it below',
		source: 'a **bo⟦⟧ld** z\n',
		mode: 'live',
		gesture: paste('one\n\ntwo'),
		expect: { source: 'a **boone**\n\n**twold** z\n', caret: { at: 18, holds: 'text' } }
	},
	{
		name: 'source mode keeps the run’s bytes',
		source: 'a **bo⟦⟧ld** z\n',
		gesture: paste('one\n\ntwo'),
		expect: { source: 'a **boone\n\ntwold** z\n' }
	},
	live(
		'a paragraph between them lands as written',
		'a **bo⟦⟧ld** z\n',
		paste('one\n\nmid\n\ntwo'),
		'a **boone**\n\nmid\n\n**twold** z\n'
	),
	live(
		'a table in a bold run',
		'a **bo⟦⟧ld** z\n',
		paste(TABLE),
		'a **bo**\n\n| a |\n| - |\n\n**ld** z\n'
	),
	live(
		'a fence in a bold run',
		'a **bo⟦⟧ld** z\n',
		paste(FENCE),
		'a **bo**\n\n```\nx\n```\n**ld** z\n'
	),
	live(
		'a list whose last item takes the reopened half',
		'a **bo⟦⟧ld** z\n',
		paste('- q\n- r'),
		'a **bo**\n\n- q\n- r**ld** z\n'
	),
	live(
		'blank lines alone are Enter’s bytes',
		'a **bo⟦⟧ld** z\n',
		paste('\n\n'),
		'a **bo**\n\n**ld** z\n'
	),
	live(
		'Paste as plain text sets the same boundary',
		'a **bo⟦⟧ld** z\n',
		plain('one\n\ntwo'),
		'a **boone**\n\n**twold** z\n'
	),
	live(
		'a half behind an item’s last line reopens in the marker that opens there',
		'a __bo⟦⟧ld__ z\n',
		paste('- q\n- r'),
		'a __bo__\n\n- q\n- r**ld** z\n'
	),
	live(
		'so does the half behind the last item of a list the caret’s item takes in',
		'- a __bo⟦⟧ld__ z\n',
		paste('- q\n- r'),
		'- a __boq__\n- r**ld** z\n'
	),
	live(
		'a half on punctuation behind a letter opens in no marker, so the cut stays literal',
		'a **bo⟦⟧(ld)** z\n',
		paste('- q\n- r'),
		'a **bo\n\n- q\n- r(ld)** z\n'
	),
	live(
		'so does a run in a run of its own kind',
		'a *b _c⟦⟧d_ e* z\n',
		paste('- q\n- r'),
		'a *b _c\n\n- q\n- rd_ e* z\n'
	),
	live('emphasis', 'a *bo⟦⟧ld* z\n', paste('one\n\ntwo'), 'a *boone*\n\n*twold* z\n'),
	live('strikethrough', 'a ~~bo⟦⟧ld~~ z\n', paste(TABLE), 'a ~~bo~~\n\n| a |\n| - |\n\n~~ld~~ z\n'),
	live('underscores', 'a __bo⟦⟧ld__ z\n', paste('one\n\ntwo'), 'a __boone__\n\n__twold__ z\n'),
	live(
		'nested runs',
		'a ***bo⟦⟧ld*** z\n',
		paste(TABLE),
		'a ***bo***\n\n| a |\n| - |\n\n***ld*** z\n'
	),
	live(
		'a link carries its destination to both halves',
		'a [bo⟦⟧ld](u) z\n',
		paste('one\n\ntwo'),
		'a [boone](u)\n\n[twold](u) z\n'
	),
	live('a code span', 'a `bo⟦⟧ld` z\n', paste(TABLE), 'a `bo`\n\n| a |\n| - |\n\n`ld` z\n'),
	live(
		'a code span whose reopened fence would touch a backtick keeps the literal cut',
		'a ``b`⟦⟧c`` z\n',
		paste(TABLE),
		'a ``b`\n\n| a |\n| - |\n\nc`` z\n'
	),
	live(
		'an image’s alt text keeps the literal cut',
		'a ![al⟦⟧t](i.png) z\n',
		paste(TABLE),
		'a ![al\n\n| a |\n| - |\n\nt](i.png) z\n'
	),
	live(
		'in an autolink the cut moves to its nearer edge',
		'a <http://x⟦⟧y.z> w\n',
		paste(TABLE),
		'a <http://xy.z>\n\n| a |\n| - |\n\n w\n'
	),
	live(
		'and the whole paste with it',
		'a <http://x⟦⟧y.z> w\n',
		paste('one\n\ntwo'),
		'a <http://xy.z>one\n\ntwo w\n'
	),
	live(
		'a range over the whole autolink leaves none of it',
		'a ⟦<http://xy.z>⟧ w\n',
		paste('one\n\ntwo'),
		'a one\n\ntwo w\n'
	),
	live(
		'a range that cuts an autolink is the removal then the paste: the remnant is the removal’s',
		'a <http://x⟦y.z> w⟧ v\n',
		paste('one\n\ntwo'),
		'a <http://xone\n\ntwo v\n'
	),
	live(
		'a half with none of the run’s text takes none of its delimiters',
		'a **⟦⟧bold** z\n',
		paste(TABLE),
		'a \n\n| a |\n| - |\n\n**bold** z\n'
	),
	live(
		'at a run’s end the half below takes none',
		'a **bold⟦⟧** z\n',
		paste(TABLE),
		'a **bold**\n\n| a |\n| - |\n\n z\n'
	),
	live(
		'a range that starts in a run, a table',
		'a **b⟦c** d⟧ e\n',
		paste(TABLE),
		'a **b**\n\n| a |\n| - |\n\n e\n'
	),
	live(
		'a range that starts in a run, two paragraphs',
		'a **b⟦c** d⟧ e\n',
		paste('one\n\ntwo'),
		'a **bone**\n\n**two** e\n'
	),
	live(
		'a range that ends in a run, two paragraphs',
		'a ⟦b **c⟧d** e\n',
		paste('one\n\ntwo'),
		'a one\n\ntwo**d** e\n'
	),
	live(
		'a range over a run’s inner text, a table',
		'a **⟦b⟧** c\n',
		paste(TABLE),
		'a \n\n| a |\n| - |\n\n c\n'
	),
	live(
		'a range over a run’s inner text, two paragraphs',
		'a **⟦b⟧** c\n',
		paste('one\n\ntwo'),
		'a **one**\n\n**two** c\n'
	),
	live(
		'a list breaking out of an item',
		'- a **bo⟦⟧ld** z\n',
		paste('1. q\n2. r'),
		'- a **bo**\n1. q\n2. r\n- **ld** z\n'
	),
	live(
		'a quote taken in by a quote',
		'> a **bo⟦⟧ld** z\n',
		paste('> q\n>\n> r'),
		'> a **boq**\n>\n> **rld** z\n'
	),
	live(
		'a run in a setext title keeps the underline above too',
		'a **bo⟦⟧ld** z\n===\n',
		paste(TABLE),
		'a **bo**\n===\n\n| a |\n| - |\n\n**ld** z\n'
	)
];

// Miss-analysis: every plain row pasted into a paragraph, a list or a code block, so no row saw
// the one escape rule meet a title row or a cell.
const PLAIN_ROWS: NamedRow[] = [
	{
		name: 'P plain text in a directive’s title goes in as written, the title being literal',
		source: ':::note Ti⟦⟧tle\nbody\n:::\n',
		gesture: plain('**x**'),
		expect: { source: ':::note Ti**x**tle\nbody\n:::\n' }
	},
	{
		name: 'P and in a summary',
		source: '<details>\n<summary>Ti⟦⟧tle</summary>\n\nbody\n\n</details>\n',
		gesture: plain('**x**'),
		expect: { source: '<details>\n<summary>Ti**x**tle</summary>\n\nbody\n\n</details>\n' }
	},
	{
		name: 'P an alert’s title reads Markdown, so plain text goes in escaped',
		source: '> [!NOTE] Ti⟦⟧tle\n> body\n',
		gesture: plain('**x**'),
		expect: { source: '> [!NOTE] Ti\\*\\*x\\*\\*tle\n> body\n' }
	},
	{
		name: 'P a cell takes plain text escaped, its pipe too',
		source: '| a⟦⟧ | b |\n| - | - |\n| c | d |\n',
		gesture: plain('x|y **z**'),
		expect: { source: '| ax\\|y \\*\\*z\\*\\* | b |\n| - | - |\n| c | d |\n' }
	}
];

// Miss-analysis: no to-do, drawn or named, had text that alone opens a fence, so the closing line
// the block's own write put under it met no row.
const TODO = '- [x] ````t⟦s⟧\n\n  next\n';
const TODO_ROWS: NamedRow[] = [
	...both(
		'T a cut in a to-do’s first line that alone opens a fence writes no closing line',
		TODO,
		'cut',
		'- [x] ````t\n\n  next\n'
	),
	...both('T text pasted over it writes none', TODO, paste('x'), '- [x] ````tx\n\n  next\n'),
	...both(
		'T nor do blocks pasted into it',
		TODO,
		paste('> q\n\nafter'),
		'- [x] ````t\n\n  > q\n\n  after\n\n  next\n'
	)
];

export const SPLIT_ROWS: NamedRow[] = [
	...STRUCTURE_ROWS,
	...EMPTIED_ROWS,
	...RUN_ROWS,
	...PLAIN_ROWS,
	...TODO_ROWS
];
