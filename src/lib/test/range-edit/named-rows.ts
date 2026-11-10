// The range-edit core's named rows: each shape the contract states by bytes, `⟦` and `⟧` marking
// the range in its source. A row is one call, some with a second at the caret the first left, or at
// `at` (`paste back` pastes what the first wrote to the clipboard, `with own` its own entry too).

import type { Gesture, RangeEditResult } from '#lib/range-edit/edit-range.js';
import type { Mode } from '#lib/range-edit/host.js';

export interface NamedRow {
	name: string;
	source: string;
	mode?: Mode;
	gesture: Gesture;
	expect: Partial<RangeEditResult>;
	then?: {
		gesture: Gesture | 'paste back' | 'paste back with own';
		at?: number;
		/** The bytes the second call runs on, where another removal left other bytes than the first. */
		source?: string;
		expect: Partial<RangeEditResult>;
	};
}

const text = (at: number): RangeEditResult['caret'] => ({ at, holds: 'text' });
const paste = (t: string): Gesture => ({ paste: t, plain: false, holds: 'text' });
const plain = (t: string): Gesture => ({ paste: t, plain: true, holds: 'text' });
// A paste at a caret between two blocks, as the editor's gap caret holds it.
const between = (t: string): Gesture => ({ paste: t, plain: false, holds: 'boundary' });
const backToStart = (marked: string) => ({ source: unmark(marked) });
// Filler that puts more bytes either side than an own entry hashes, so only its hashes place it.
const LONG = 'a paragraph long enough that the entry hashes only part of it';

/** The source a row's marked source stands for. */
export const unmark = (marked: string) => marked.replace(/[⟦⟧]/g, '');

/** The range a row's marks stand for. */
export function rangeOf(marked: string) {
	return { from: marked.indexOf('⟦'), to: marked.indexOf('⟧') - 1 };
}

export const NAMED_ROWS: NamedRow[] = [
	// ── Cut, then paste back (laws 1, 3) ──
	{
		name: 'L3 two paragraphs, cut from the middle of one into the middle of the next',
		source: 'alpha ⟦bravo\n\ncharlie ⟧delta\n',
		gesture: 'cut',
		expect: { source: 'alpha delta\n', clipboard: 'bravo\n\ncharlie ', caret: text(6) },
		then: { gesture: 'paste back', expect: backToStart('alpha bravo\n\ncharlie delta\n') }
	},
	{
		name: 'L3 from a nested quote out into its parent',
		source: '> > alpha ⟦bravo\n> > more\n>\n> outer ⟧delta\n',
		gesture: 'cut',
		expect: {
			source: '> > alpha delta\n',
			clipboard: '> bravo\n> more\n\nouter ',
			caret: text(10)
		},
		then: {
			gesture: 'paste back',
			expect: backToStart('> > alpha bravo\n> > more\n>\n> outer delta\n')
		}
	},
	{
		name: 'L3 from a quote out past a line it reads without a marker',
		source: '> alpha ⟦bravo\ncharlie\n\ndelta ⟧echo\n',
		gesture: 'cut',
		expect: { source: '> alpha echo\n', clipboard: '> bravo\ncharlie\n\ndelta ', caret: text(8) },
		then: { gesture: 'paste back', expect: backToStart('> alpha bravo\ncharlie\n\ndelta echo\n') }
	},
	{
		name: 'L3 from a footnote body out into the paragraph after it',
		source: '[^1]: alpha ⟦bravo\n    charlie\n\ndelta ⟧echo\n',
		gesture: 'cut',
		expect: {
			source: '[^1]: alpha echo\n',
			clipboard: '[^1]: bravo\n    charlie\n\ndelta ',
			caret: text(12)
		},
		then: {
			gesture: 'paste back',
			expect: backToStart('[^1]: alpha bravo\n    charlie\n\ndelta echo\n')
		}
	},
	{
		name: 'L3 from an alert out into the paragraph after it',
		source: '> [!NOTE]\n> alpha ⟦bravo\n> charlie\n\ndelta ⟧echo\n',
		gesture: 'cut',
		expect: {
			source: '> [!NOTE]\n> alpha echo\n',
			clipboard: '> [!NOTE]\n> bravo\n> charlie\n\ndelta ',
			caret: text(18)
		},
		then: {
			gesture: 'paste back',
			expect: backToStart('> [!NOTE]\n> alpha bravo\n> charlie\n\ndelta echo\n')
		}
	},
	{
		name: 'L3 from a fenced container out: its closing line stays, and the paste back takes it',
		source: ':::note\nalpha ⟦bravo\ncharlie\n:::\n\ndelta ⟧echo\n',
		gesture: 'cut',
		expect: {
			source: ':::note\nalpha echo\n:::\n',
			clipboard: ':::note\nbravo\ncharlie\n:::\n\ndelta ',
			caret: text(14)
		},
		then: {
			gesture: 'paste back',
			expect: backToStart(':::note\nalpha bravo\ncharlie\n:::\n\ndelta echo\n')
		}
	},
	{
		name: 'L3 across two list items',
		source: '- alpha ⟦bravo\n  more\n- charlie ⟧delta\n',
		gesture: 'cut',
		expect: { source: '- alpha delta\n', clipboard: '- bravo\n  more\n- charlie ', caret: text(8) },
		then: { gesture: 'paste back', expect: backToStart('- alpha bravo\n  more\n- charlie delta\n') }
	},
	{
		name: 'L3 from a paragraph into the quote after it',
		source: 'alpha ⟦bravo\n\n> charlie ⟧delta\n',
		gesture: 'cut',
		expect: { source: 'alpha delta\n', clipboard: 'bravo\n\n> charlie ', caret: text(6) },
		then: { gesture: 'paste back', expect: backToStart('alpha bravo\n\n> charlie delta\n') }
	},
	{
		name: 'L3 a code block held whole goes with its line, and the blank line under it at the top',
		source: '⟦```\ncode();\n```⟧\n\n| H0 |\n| --- |\n',
		gesture: 'cut',
		expect: { source: '| H0 |\n| --- |\n', clipboard: '```\ncode();\n```' },
		then: {
			gesture: 'paste back with own',
			expect: backToStart('```\ncode();\n```\n\n| H0 |\n| --- |\n')
		}
	},
	{
		name: 'L3 into a table at its first row takes the table whole',
		source: '⟦x\n# h\n| A | B |\n| - | - |⟧\n',
		gesture: 'cut',
		expect: { source: '\n', clipboard: 'x\n# h\n| A | B |\n| - | - |', caret: text(0) },
		then: { gesture: 'paste back', expect: backToStart('x\n# h\n| A | B |\n| - | - |\n') }
	},
	{
		name: 'L3 a CRLF paragraph cut whole keeps its line endings and its missing last one',
		source: '⟦one\r\none⟧',
		gesture: 'cut',
		expect: { source: '', clipboard: 'one\r\none', caret: text(0) },
		then: { gesture: 'paste back', expect: { source: 'one\none' } }
	},
	{
		name: 'L3 a fragment that reads as a list alone pastes back as text',
		source: 'see item ⟦1. then⟧ x\n',
		gesture: 'cut',
		expect: { source: 'see item  x\n', clipboard: '1. then', caret: text(9) },
		then: { gesture: 'paste back', expect: backToStart('see item 1. then x\n') }
	},
	{
		name: 'L3 inside a nested list, the outer item indent stays behind',
		source: '- i0\n  - ⟦i1\n    - i2\n  - i3⟧\n',
		gesture: 'cut',
		expect: { source: '- i0\n  - \n', clipboard: '- i1\n  - i2\n- i3', caret: text(9) },
		then: { gesture: 'paste back', expect: backToStart('- i0\n  - i1\n    - i2\n  - i3\n') }
	},
	// Miss-analysis: the merge ran only for a clipboard whose last block takes joined text, and no
	// row emptied a container and pasted a container ending in code back on its line.
	{
		name: 'L3 a quote cut out past its end into code pastes back into the quote it emptied',
		source: '> ⟦q\n\n    code⟧\n',
		gesture: 'cut',
		expect: { source: '> \n', clipboard: '> q\n\n    code', caret: text(2) },
		then: { gesture: 'paste back', expect: backToStart('> q\n\n    code\n') }
	},
	{
		name: 'L3 an alert cut out past its end pastes back into the alert it emptied',
		source: '> [!TIP]\n> ⟦a\n\n[^1]: x\n    - y⟧\n',
		gesture: 'cut',
		expect: {},
		then: { gesture: 'paste back', expect: backToStart('> [!TIP]\n> a\n\n[^1]: x\n    - y\n') }
	},
	{
		name: 'L3 a quote line read without its marker comes back with it',
		source: '> alpha ⟦bravo\ncharlie⟧\n',
		gesture: 'cut',
		expect: { source: '> alpha \n', clipboard: 'bravo\ncharlie', caret: text(8) },
		then: { gesture: 'paste back', expect: { source: '> alpha bravo\n> charlie\n' } }
	},
	// ── Backspace and Delete (law 4) ──
	{
		name: 'L4 Backspace from a heading into the paragraph under it',
		source: '# ⟦head\n\ntwo words\ntwo words⟧\n# head\n',
		gesture: 'backspace',
		expect: { source: '# \n# head\n', caret: text(2) }
	},
	{
		name: 'L4 Delete over the same range',
		source: '# ⟦head\n\ntwo words\ntwo words⟧\n# head\n',
		gesture: 'delete',
		expect: { source: '# \n# head\n', caret: text(2) }
	},
	{
		name: 'L4 a range into a heading text start keeps the heading text',
		source: ':::note⟦\ntwo words\n# ⟧head\n\n:::\n',
		gesture: 'backspace',
		expect: { source: ':::note\nhead\n\n:::\n', caret: text(8) }
	},
	{
		name: 'C13 a range from a title row end to its body start takes nothing',
		source: ':::note⟦\n⟧a\n:::\n',
		gesture: 'backspace',
		expect: { source: ':::note\na\n:::\n', caret: text(8) }
	},
	// ── Paste at a caret (law 9) ──
	{
		name: 'L9 two paragraphs pasted mid-paragraph join the text either side',
		source: 'alpha ⟦⟧bravo\n',
		gesture: paste('one\n\ntwo'),
		expect: { source: 'alpha one\n\ntwobravo\n', caret: text(14) }
	},
	{
		name: 'L9 blocks pasted at a heading text start join it, the last taking its text',
		source: '# ⟦⟧Hi\n',
		gesture: paste('abc\n\ndef'),
		expect: { source: '# abc\n\ndefHi\n', caret: text(10) }
	},
	{
		name: 'L9 blocks pasted at a line end join it, the last taking the lines after',
		source: 'abc⟦⟧\nAfter\n',
		gesture: paste('x\n\ny'),
		expect: { source: 'abcx\n\ny\nAfter\n', caret: text(7) }
	},
	{
		name: 'L9 blocks pasted on a lazy quote line stay in the quote',
		source: '> a\nb⟦⟧\n',
		gesture: paste('x\n\ny'),
		expect: { source: '> a\nbx\n>\n> y\n', caret: text(12) }
	},
	{
		name: 'L9 one line goes in as text, whatever it reads as alone',
		source: 'ab⟦⟧cd\n',
		gesture: paste('* c'),
		expect: { source: 'ab* ccd\n', caret: text(5) }
	},
	{
		name: 'L9 live, a paste past a hidden closing run goes where the caret is',
		source: 'a **b**⟦⟧\n',
		mode: 'live',
		gesture: paste('x'),
		expect: { source: 'a **b**x\n' }
	},
	{
		name: 'L9 a footnote line keeps its indent, the next lines its body column',
		source: '  [^n]: ⟦⟧a\n',
		gesture: paste('line one\nline two\n'),
		expect: { source: '  [^n]: line one\n    line two\n    a\n' }
	},
	{
		name: 'L9 a quote line keeps its spelling, and the new line takes it',
		source: '>⟦⟧a\n',
		gesture: paste('x\ny'),
		expect: { source: '>x\n>ya\n' }
	},
	{
		name: 'L9 a paste into the empty paragraph above a fence adds no line',
		source: '    code\n\n⟦⟧\n```\n```\n\n    code\n',
		gesture: paste('x'),
		expect: { source: '    code\n\nx\n```\n```\n\n    code\n' }
	},
	{
		name: 'L9 a heading pasted mid-paragraph stays a heading',
		source: 'ab⟦⟧cd\n',
		gesture: paste('# T\nbody'),
		expect: { source: 'ab\n\n# T\nbodycd\n' }
	},
	// ── A title row takes a paste on its one line, never in its name ──
	// Miss-analysis: no row pasted at a name's end, and law 11 never drew a title row with a
	// clipboard of two lines.
	{
		name: 'L9 a paste at the end of a row’s name starts its title, a space first',
		source: ':::note⟦⟧\na\n:::\n',
		gesture: paste('😀'),
		expect: { source: ':::note 😀\na\n:::\n', caret: text(10) }
	},
	{
		name: 'L11 the same as plain text, as written where a title shows its bytes',
		source: '> :::note⟦⟧\n> a\n> :::\n',
		gesture: plain('*x*'),
		expect: { source: '> :::note *x*\n> a\n> :::\n' }
	},
	{
		name: 'L9 a run of line breaks pasted into a title is one space',
		source: ':::note Ti⟦⟧tle\nbody\n:::\n',
		gesture: paste('a\n\nb\n'),
		expect: { source: ':::note Tia btle\nbody\n:::\n', caret: text(13) }
	},
	{
		name: 'L11 plain text pasted into a title stays on its line',
		source: ':::note Ti⟦⟧tle\nbody\n:::\n',
		gesture: plain('x\n*y*'),
		expect: { source: ':::note Tix *y*tle\nbody\n:::\n' }
	},
	// ── Lines pasted into literal text stay in its block ──
	// Miss-analysis: law 11 read a literal paste with no marker on its later lines, so the core
	// dropped them, and no row pasted two lines into indented code or into code in a container.
	{
		name: 'L9 lines pasted into indented code take the caret line’s indent',
		source: '    co⟦⟧de\n',
		gesture: paste('a\n\nb'),
		expect: { source: '    coa\n\n    bde\n', caret: text(14) }
	},
	{
		name: 'L9 a fence pasted on indented code’s last line stays code, and opens nothing',
		source: '    code\n\t⟦⟧\n\nnext\n',
		gesture: paste('```\ncode\n```\n'),
		expect: { source: '    code\n\t```\n\tcode\n\t```\n\n\nnext\n' }
	},
	{
		name: 'L11 plain lines pasted into code in a quote keep the quote’s marker',
		source: '> ```\n> x⟦⟧\n> ```\n',
		gesture: plain('a\n*b*'),
		expect: { source: '> ```\n> xa\n> *b*\n> ```\n' }
	},
	{
		name: 'L11 a plain fence line pasted into a code block grows its fence',
		source: '```\nx⟦⟧\n```\n',
		gesture: plain('a\n```'),
		expect: { source: '````\nxa\n```\n````\n' }
	},
	{
		name: 'L11 plain lines into indented code in a list item keep the item and the indent',
		source: '- a\n\n      c⟦⟧ode\n',
		gesture: plain('x\ny'),
		expect: { source: '- a\n\n      cx\n      yode\n' }
	},
	// ── A list pasted into a list of the other kind breaks out of it (C8) ──
	// Miss-analysis: the merge fact's mismatch rule was read by neither the core nor the law's
	// expectation, and every list row pasted a list of the caret's own kind.
	{
		name: 'C8 a bullet list pasted in an ordered item lands between the list’s halves',
		source: '1. a⟦⟧b\n2. c\n',
		gesture: paste('- q\n- r'),
		expect: { source: '1. a\n- q\n- r\n2. b\n3. c\n', caret: text(12) }
	},
	{
		name: 'C8 an ordered list pasted in a bullet item does the same, CRLF',
		source: '> - a⟦⟧b\r\n> - c\r\n',
		gesture: paste('1. q\n2. r\n'),
		expect: { source: '> - a\r\n> 1. q\r\n> 2. r\r\n> - b\r\n> - c\r\n' }
	},
	{
		name: 'C8 at an item’s first text byte the item opens the second half as it stands',
		source: '1. x\n2. ⟦⟧ab\n',
		gesture: paste('- q'),
		expect: { source: '1. x\n- q\n2. ab\n', caret: text(8) }
	},
	{
		name: 'C8 at an item’s end the items after it number on, and a wider number moves its lines',
		source: '8. x\n9. a⟦⟧b\n   more\n10. c\n',
		gesture: paste('- q\n- r'),
		expect: { source: '8. x\n9. a\n- q\n- r\n10. b\n    more\n11. c\n' }
	},
	{
		name: 'C8 the nearest list decides, whatever list holds it',
		source: '- x\n  1. a⟦⟧b\n',
		gesture: paste('- q\n- r'),
		expect: { source: '- x\n  1. a\n  - q\n  - r\n  2. b\n' }
	},
	{
		name: 'C8 a last pasted paragraph stays apart from the item under it',
		source: '1. a⟦⟧b\n2. c\n',
		gesture: paste('- q\n\npara'),
		expect: { source: '1. a\n- q\n\npara\n\n2. b\n3. c\n' }
	},
	// Miss-analysis: every break-out row's list stood at its line's start, where a pasted list at
	// the line's start can't take the item under it in; the 120-document draw held no indented one.
	{
		name: 'C8 a list breaking out of an indented list stands in that list’s column',
		source: '   - a⟦⟧b\n   - c\n',
		gesture: paste('1. q\n2. r'),
		expect: { source: '   - a\n   1. q\n   2. r\n   - b\n   - c\n', caret: text(22) }
	},
	{
		name: 'C8 at an indented item’s first text byte too, the to-do under it a sibling',
		source: '   - [ ] ⟦⟧word\r\n',
		gesture: paste('1. one'),
		expect: { source: '   1. one\r\n   - [ ] word\r\n', caret: text(9) }
	},
	{
		name: 'C8 with nothing after the caret, the items after it stay the list’s',
		source: '   1. a⟦⟧\n   2. c\n',
		gesture: paste('- q\n- r'),
		expect: { source: '   1. a\n   - q\n   - r\n   2. c\n' }
	},
	{
		name: 'C8 an indent the outer item’s tab spells goes with the pasted list',
		source: '- x\n\t- a⟦⟧b\n',
		gesture: paste('1. q\n2. r'),
		expect: { source: '- x\n\t- a\n\t1. q\n\t2. r\n\t- b\n' }
	},
	{
		name: 'C8 in a footnote, the pasted list keeps the indent on the label’s line',
		source: '[^1]:    - ⟦⟧d\n',
		gesture: paste('1. one'),
		expect: { source: '[^1]:    1. one\n       - d\n' }
	},
	{
		name: 'C8 the indent a clipboard brings gives way to the list’s',
		source: '   - a⟦⟧b\n',
		gesture: paste(' 1. q\n 2. r'),
		expect: { source: '   - a\n   1. q\n   2. r\n   - b\n' }
	},
	{
		name: 'C8 an indented clipboard pasted in a list at the line’s start leaves the item too',
		source: '1. n⟦⟧b\n',
		gesture: paste('   - q\n     more\n   - r'),
		expect: { source: '1. n\n- q\n  more\n- r\n2. b\n' }
	},
	{
		name: 'C8 a blank line already under the pasted list is the only one',
		source: '- a\n\n  ⟦⟧\n\n1. z\n',
		gesture: paste('1. one'),
		expect: { source: '- a\n\n  \n1. one\n\n1. z\n' }
	},
	{
		name: 'C8 a last pasted list of the caret’s kind stays apart from the item under it',
		source: '- x⟦⟧word\n',
		gesture: paste('1. q\n\n- r'),
		expect: { source: '- x\n1. q\n\n- r\n\n- word\n' }
	},
	// ── A new line on a list item's or footnote's lazy line stays in it (§ 5.5) ──
	// Miss-analysis: the lazy-line rows and law 9's expectation both read a quote, whose every line
	// has a marker to copy; an item's later lines carry an indent, which neither turned its marker into.
	{
		name: 'L9 blocks pasted on a list item’s lazy line stay in the item',
		source: '- a\nlazy⟦⟧\n',
		gesture: paste('x\n\ny'),
		expect: { source: '- a\nlazyx\n\n  y\n' }
	},
	{
		name: 'L9 on a later lazy line they take the indent of the item’s nearest marked line',
		source: '1. a\n   b\nlazy⟦⟧\n',
		gesture: paste('x\n\ny'),
		expect: { source: '1. a\n   b\nlazyx\n\n   y\n' }
	},
	{
		name: 'L9 on a footnote’s lazy line they stay in the footnote',
		source: '[^1]: a\nlazy⟦⟧\n',
		gesture: paste('x\n\ny'),
		expect: { source: '[^1]: a\nlazyx\n\n    y\n' }
	},
	// ── Blocks pasted mid-heading leave its tail a paragraph (§ 5.4 rule 4) ──
	// Miss-analysis: law 9's split shape reads a paragraph only, and the one heading row pasted at
	// the heading's end, where no tail is left to take the marker again.
	{
		name: 'L9 a code block pasted mid-heading leaves the text after it a paragraph',
		source: '# he⟦⟧ad\n',
		gesture: paste('```\ncode\n```'),
		expect: { source: '# he\n\n```\ncode\n```\nad\n' }
	},
	// ── A paste where the caret holds no text lands as blocks of its own (§ 5.4 rule 7) ──
	// Miss-analysis: a paste gesture couldn't say its caret stood between blocks, so every row and
	// law pasted at a byte in text, and a cut's `'boundary'` caret was pasted at as if it held text.
	{
		name: 'L9 text pasted in the gap above a table stays a paragraph above it',
		source: '⟦⟧| a |\n| - |\n',
		gesture: between('x'),
		expect: { source: 'x\n\n| a |\n| - |\n', caret: text(1) }
	},
	{
		name: 'L9 in the gap above a paragraph it stays a paragraph of its own',
		source: 'a\n\n⟦⟧b\n',
		gesture: between('x'),
		expect: { source: 'a\n\nx\n\nb\n', caret: text(4) }
	},
	{
		name: 'L9 a list pasted in the gap under a list of its kind stays a list of its own',
		source: '- a\n⟦⟧# h\n',
		gesture: between('- q'),
		expect: { source: '- a\n\n- q\n# h\n', caret: text(8) }
	},
	{
		name: 'L9 in the gap after a quote, a pasted paragraph stays out of it',
		source: '> a\n⟦⟧',
		gesture: between('x'),
		expect: { source: '> a\n\nx' }
	},
	{
		name: 'L9 with nothing after the gap, the clipboard’s last line ending stays',
		source: '# h\n⟦⟧',
		gesture: between('x\n'),
		expect: { source: '# h\nx\n', caret: { at: 6, holds: 'boundary' } }
	},
	// Miss-analysis: no draw cuts a list's middle item whole, and law 9 reads no place between items,
	// so a pasted item kept apart from both its neighbours, three lists for one, met no check.
	{
		name: 'L3 an item cut from between two items pastes back as the list’s item',
		source: '- a\n⟦- q⟧\n- b\n',
		gesture: 'cut',
		expect: { source: '- a\n- b\n', caret: { at: 4, holds: 'block' } },
		then: { gesture: 'paste back', expect: backToStart('- a\n- q\n- b\n') }
	},
	{
		name: 'L9 a paragraph pasted between two items parts the list around it',
		source: '- a\n⟦⟧- b\n',
		gesture: between('para'),
		expect: { source: '- a\n\npara\n- b\n' }
	},
	{
		name: 'L9 at a table row’s first byte nothing lands as a block: the rows stay one table',
		source: '| a |\n| - |\n⟦⟧| b |\n',
		gesture: { paste: '| x |', plain: false, holds: 'block' },
		expect: { source: '| a |\n| - |\n| x || b |\n' }
	},
	{
		name: 'L5 over the end of a quoted paragraph and the block after, the paste is a paragraph of its own',
		source: '> a\n> ⟦b\n\npara⟧\n',
		gesture: paste('x'),
		expect: { source: '> a\n>\n> x\n' }
	},
	{
		name: 'L9 in a quote, the pasted lines and the block after them keep its marker',
		source: '> a\n>\n> ⟦⟧```\n> x\n> ```\n',
		gesture: between('one\ntwo'),
		expect: { source: '> a\n>\n> one\n> two\n> ```\n> x\n> ```\n' }
	},
	{
		name: 'L12 a rule cut from above a code block pastes back exact with its own entry',
		source: 'para\n\n⟦---⟧\n\n```\nx\n```\n',
		gesture: 'cut',
		expect: { source: 'para\n\n```\nx\n```\n', caret: { at: 6, holds: 'boundary' } },
		then: {
			gesture: 'paste back with own',
			expect: backToStart('para\n\n---\n\n```\nx\n```\n')
		}
	},
	{
		name: 'L3 its text alone lands the rule as a block above the code',
		source: 'para\n\n⟦---⟧\n\n```\nx\n```\n',
		gesture: 'cut',
		expect: { clipboard: '---' },
		then: { gesture: 'paste back', expect: { source: 'para\n\n---\n```\nx\n```\n' } }
	},
	{
		name: 'L3 a quote cut from above a list pastes back above it, the list still a list',
		source: 'x\n\n⟦> a\n> b⟧\n\n- c\n',
		gesture: 'cut',
		expect: { source: 'x\n\n- c\n', caret: { at: 3, holds: 'block' } },
		then: { gesture: 'paste back', expect: { source: 'x\n\n> a\n> b\n- c\n' } }
	},
	{
		name: 'L9 a paste over a range that leaves the caret before an item keeps it an item',
		source: '[^1]: ⟦**b**\n\t- x\n    ⟧- y\n',
		gesture: paste('a\nb'),
		expect: { source: '[^1]: a\n    b\n    - y\n' }
	},
	{
		name: 'L9 at a heading’s first byte the pasted lines land above the heading',
		source: '⟦⟧# h\n',
		gesture: paste('x\ny'),
		expect: { source: 'x\ny\n# h\n', caret: text(3) }
	},
	{
		name: 'L5 text over a rule held whole stays apart from the indented code under it',
		source: 'para\n⟦***⟧\n    code\n',
		gesture: paste('p'),
		expect: { source: 'para\np\n\n    code\n', caret: text(6) }
	},
	// ── Copy (law 10) ──
	{
		name: 'L10 a copy ending at a list item text start carries its marker',
		source: '⟦# h\n- ⟧a\n',
		gesture: 'copy',
		expect: { source: '# h\n- a\n', clipboard: '# h\n- ' }
	},
	{
		name: 'L10 a copy ending at a list item text end brings no line ending',
		source: '⟦a\n- b⟧\n',
		gesture: 'copy',
		expect: { source: 'a\n- b\n', clipboard: 'a\n- b' }
	},
	// Miss-analysis: the no-line-ending rows ran in source mode, and live added the container's ending.
	{
		name: 'L10 live, a copy ending at a list item text end brings no line ending either',
		source: '⟦a\n- b⟧\n',
		mode: 'live',
		gesture: 'copy',
		expect: { clipboard: 'a\n- b' }
	},
	{
		name: 'L10 live, a copy into a table at its first row takes it whole, no last line ending',
		source: 'al⟦pha\n\n| a | b |\n| - | - |\n| 1 | 2 |⟧\n\nafter\n',
		mode: 'live',
		gesture: 'copy',
		expect: { clipboard: 'pha\n\n| a | b |\n| - | - |\n| 1 | 2 |' }
	},
	{
		name: 'L10 a copy inside one quote carries none of its markers',
		source: '> al⟦pha\n> be⟧ta\n',
		gesture: 'copy',
		expect: { clipboard: 'pha\nbe' }
	},
	// ── Paste as plain text (law 11) ──
	{
		name: 'L11 plain text into a paragraph is escaped where it would read as Markdown',
		source: 'ab⟦⟧cd\n',
		gesture: plain('**x**'),
		expect: { source: 'ab\\*\\*x\\*\\*cd\n' }
	},
	{
		name: 'L11 plain text into an indented code block goes in as written',
		source: '    code⟦⟧\n',
		gesture: plain('# x'),
		expect: { source: '    code# x\n' }
	},
	// ── Drop (law 6) ──
	{
		name: 'L6 a word dragged to the end of the line',
		source: 'alpha ⟦bravo ⟧charlie\n',
		gesture: { drop: 19, copy: false },
		expect: { source: 'alpha charliebravo \n' }
	},
	// ── A first-line marker whose line goes moves to the container's new first line ──
	{
		name: 'C5 a footnote keeps its label when the range takes its first line',
		source: 'p⟦\n\n[^1]: a⟧\n\n    b\n',
		gesture: 'backspace',
		expect: { source: 'p\n\n[^1]: b\n', caret: text(1) }
	},
	// A list item's marker line goes with the text it joins, and the lines under it keep their bytes,
	// as Backspace at the item's start does (`structural-edits.md` § Structural operations).
	{
		name: 'M1 a range from mid-paragraph into an item first line takes the marker line',
		source: 'p⟦q\n\n- a⟧b\n\n  c\n',
		gesture: 'backspace',
		expect: { source: 'pb\n\n  c\n', caret: text(1) }
	},
	{
		name: 'M1 a range taking an item first line leaves the line under it as it stood',
		source: 'p⟦\n\n- a⟧\n\n  b\n',
		gesture: 'backspace',
		expect: { source: 'p\n\n  b\n', caret: text(1) }
	},
	{
		name: 'M1 a deeper item under the joined one keeps its line, never a second marker (#816)',
		source: '- i0\n  - i1\n    - i⟦2\n  - i⟧3\n    - i4\n\n    p5\n',
		gesture: 'backspace',
		expect: { source: '- i0\n  - i1\n    - i3\n    - i4\n\n    p5\n', caret: text(19) }
	},
	// ── A container's first text byte, and Mod+Shift+V (both ruled 2026-11-05) ──
	{
		name: 'Q1 a quoted paragraph selected whole: Backspace leaves the quote, emptied',
		source: '> ⟦alpha⟧\n\nnext\n',
		gesture: 'backspace',
		expect: { source: '> \n\nnext\n', caret: text(2) }
	},
	{
		name: 'Q1 the same range copies the text alone, and its cut pastes back',
		source: '> ⟦alpha⟧\n\nnext\n',
		gesture: 'cut',
		expect: { source: '> \n\nnext\n', clipboard: 'alpha', caret: text(2) },
		then: { gesture: 'paste back', expect: backToStart('> alpha\n\nnext\n') }
	},
	{
		name: 'Q1 from a quoted paragraph start into the next paragraph: the quote takes the rest',
		source: '> ⟦alpha\n\nnex⟧t\n',
		gesture: 'cut',
		expect: { source: '> t\n', clipboard: '> alpha\n\nnex', caret: text(2) },
		then: { gesture: 'paste back', expect: backToStart('> alpha\n\nnext\n') }
	},
	{
		name: 'Q1 a list item selected whole keeps its marker',
		source: '- ⟦alpha⟧\n',
		gesture: 'backspace',
		expect: { source: '- \n', caret: text(2) }
	},
	{
		name: 'Q1 a footnote selected whole keeps its label',
		source: '[^1]: ⟦alpha⟧\n',
		gesture: 'backspace',
		expect: { source: '[^1]: \n', caret: text(6) }
	},
	{
		name: 'Q5 Mod+Shift+V is the plain paste, escaped where the block reads Markdown',
		source: 'a⟦⟧b\n',
		gesture: plain('**x**'),
		expect: { source: 'a\\*\\*x\\*\\*b\n' }
	},
	// ── Rulings after the second blind round ──
	{
		name: 'L9 the caret lands after everything pasted, its last line ending too',
		source: 'abc⟦⟧\n',
		gesture: paste('x\n'),
		expect: { source: 'abcx\n\n', caret: { at: 5, holds: 'boundary' } }
	},
	{
		name: 'L9 a document with no line break takes LF, whatever the clipboard held',
		source: '⟦⟧',
		gesture: paste('one\r\ntwo'),
		expect: { source: 'one\ntwo' }
	},
	{
		name: 'L10 a range the cut takes nothing from copies nothing',
		source: '    code⟦\n- ⟧x\n',
		gesture: 'copy',
		expect: { clipboard: '' }
	},
	{
		name: 'L10 live, a range the cut takes nothing from copies nothing',
		source: '    code⟦\n- ⟧x\n',
		mode: 'live',
		gesture: 'copy',
		expect: { clipboard: '' }
	},
	{
		name: 'L10 a copy that ends inside a fenced code block closes it',
		source: 'a⟦\n\n```\nxy⟧\n```\n',
		gesture: 'copy',
		expect: { clipboard: '\n\n```\nxy\n```' }
	},
	{
		name: 'L10 the same inside a quote',
		source: '> a⟦\n>\n> ```\n> xy⟧\n> ```\n',
		gesture: 'copy',
		expect: { clipboard: '\n\n```\nxy\n```' }
	},
	// Miss-analysis: every entry row pasted on the bytes its own cut left; until stage 3 a cut's
	// removal is today's, which can leave others.
	{
		name: 'L12 an entry pasted where its cut left other bytes lands as its text alone does',
		source: '⟦a\n# h⟧\nb\n',
		gesture: 'cut',
		expect: { source: '\nb\n', clipboard: 'a\n# h' },
		then: {
			gesture: 'paste back with own',
			source: '> zz\n',
			at: 4,
			expect: { source: '> zza\n> # h\n' }
		}
	},
	// Miss-analysis: law 10 leaves a range into or out of a title row to these rows, and none held one.
	{
		name: 'C13 a copy from a title row out carries its container from the opening line',
		source: ':::note Ti⟦tle\n\nbody\n:::\n\nbe⟧low\n',
		gesture: 'copy',
		expect: { clipboard: ':::note Title\n\nbody\n:::\n\nbe' }
	},
	{
		name: 'C13 a copy from an inner title row out past its outer container opens both',
		source: '::::note Outer\n\nO1\n\n:::note In⟦ner\n\nI1\n:::\n\nO2\n::::\n\nbe⟧low\n',
		gesture: 'copy',
		expect: { clipboard: '::::note Outer\n:::note Inner\n\nI1\n:::\n\nO2\n::::\n\nbe' }
	},
	{
		name: 'C13 a copy ending inside a summary closes the summary, then its section',
		source: 'ab⟦ove\n\n<details open>\n<summary>Sum⟧mary</summary>\n\nbody\n\n</details>\n',
		gesture: 'copy',
		expect: { clipboard: 'ove\n\n<details open>\n<summary>Sum</summary>\n</details>' }
	},
	// Miss-analysis: every title-row and fence-leaving row ran in source mode, where the live code
	// block's fence narrowing never runs, so a live cut over visible text took and copied nothing.
	{
		name: 'C13 a live cut from a title row into its body takes the body text',
		source: ':::note Ti⟦tle\na⟧\n:::\n',
		mode: 'live',
		gesture: 'cut',
		expect: { source: ':::note Ti\n\n:::\n', clipboard: ':::note Title\na\n:::' }
	},
	{
		name: 'L10 a live copy leaving a code block’s text carries the text the range holds',
		source: '```\nx⟦\n```\nb⟧\n',
		mode: 'live',
		gesture: 'copy',
		expect: { clipboard: '\n```\nb' }
	},
	// Miss-analysis: no row started a copy in a table's rows, so its rows pasted elsewhere read as text.
	{
		name: 'L10 a copy leaving a table below its header carries the header, so it pastes as a table',
		source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n⟦| 3 | 4 |\n\nafter⟧\n\nend\n',
		gesture: 'copy',
		expect: { clipboard: '| A | B |\n| --- | --- |\n| 3 | 4 |\n\nafter' },
		then: {
			gesture: 'paste back',
			at: 52,
			expect: {
				source:
					'| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nafter\n\n| A | B |\n| --- | --- |\n| 3 | 4 |\n\nafterend\n'
			}
		}
	},
	{
		name: 'L10 live, the same',
		source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n⟦| 3 | 4 |\n\nafter⟧\n\nend\n',
		mode: 'live',
		gesture: 'copy',
		expect: { clipboard: '| A | B |\n| --- | --- |\n| 3 | 4 |\n\nafter' }
	},
	{
		name: 'L10 a quoted table carries its header under the quote marker',
		source: '> | A |\n> | --- |\n> | 1 |\n> ⟦| 2 |\n\nafter⟧\n',
		gesture: 'copy',
		expect: { clipboard: '> | A |\n> | --- |\n> | 2 |\n\nafter' }
	},
	{
		name: 'L12 a cut leaving a table below its header pastes back exact with its entry',
		source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n⟦| 3 | 4 |\n\nafter⟧\n\nend\n',
		gesture: 'cut',
		expect: { clipboard: '| A | B |\n| --- | --- |\n| 3 | 4 |\n\nafter' },
		then: {
			gesture: 'paste back with own',
			expect: backToStart('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nafter\n\nend\n')
		}
	},
	// Miss-analysis: law 3's title-row exception rested on the entry, and no row pasted it back.
	{
		name: 'L12 a cut from a details summary out pastes back exact with its entry',
		source: '<details open>\n<summary>O⟦OOO</summary>\n\nPPPP\n\n</details>\n\nAA⟧AA\n',
		gesture: 'cut',
		expect: {
			source: '<details open>\n<summary>O</summary>\n</details>\nAA\n',
			clipboard: '<details open>\n<summary>OOOO</summary>\n\nPPPP\n\n</details>\n\nAA'
		},
		then: {
			gesture: 'paste back with own',
			expect: backToStart('<details open>\n<summary>OOOO</summary>\n\nPPPP\n\n</details>\n\nAAAA\n')
		}
	},
	{
		name: 'L12 live, the same',
		source: '<details open>\n<summary>O⟦OOO</summary>\n\nPPPP\n\n</details>\n\nAA⟧AA\n',
		mode: 'live',
		gesture: 'cut',
		expect: { source: '<details open>\n<summary>O</summary>\n</details>\nAA\n' },
		then: {
			gesture: 'paste back with own',
			expect: backToStart('<details open>\n<summary>OOOO</summary>\n\nPPPP\n\n</details>\n\nAAAA\n')
		}
	},
	{
		name: 'L12 a cut from a callout title row out pastes back exact with its entry',
		source: ':::note Ti⟦tle\nbody\n:::\n\nAA⟧AA\n',
		gesture: 'cut',
		expect: { source: ':::note Ti\n:::\nAA\n', clipboard: ':::note Title\nbody\n:::\n\nAA' },
		then: {
			gesture: 'paste back with own',
			expect: backToStart(':::note Title\nbody\n:::\n\nAAAA\n')
		}
	},
	// Miss-analysis: every fence row ended in the body; the kit's copy ends inside the opening line.
	{
		name: 'L10 a copy ending inside a fence line copies its bytes and adds no closer',
		source: 'a⟦\n\n`⟧``\nxy\n```\n',
		gesture: 'copy',
		expect: { clipboard: '\n\n`' }
	},
	{
		name: 'L9 a nested item cut out pastes back into the item it left, as any paste there lands',
		source: '- a⟦\n  - b⟧\n',
		gesture: 'cut',
		expect: { source: '- a\n', clipboard: '\n- b', caret: text(3) },
		then: { gesture: 'paste back', expect: { source: '- ab\n' } }
	},
	{
		name: 'L4 a cut into a fenced code block keeps its opening line, never its closing line alone',
		source: 'a⟦\n\n```\nxy⟧\n```\n',
		gesture: 'cut',
		expect: { source: 'a\n\n```\n\n```\n', caret: text(1) }
	},
	// Miss-analysis: no row held a container whole from its first byte, select-all's range.
	{
		name: 'L10 a quote the range holds whole copies whole, markers and all',
		source: '⟦> a\n>\n> b⟧\n',
		gesture: 'copy',
		expect: { clipboard: '> a\n>\n> b' }
	},
	// Miss-analysis: law 10 runs in source mode, and the live copy rows all sat inside one block.
	{
		name: 'L10 a live copy across blocks closes the format run it starts inside',
		source: '**bo⟦ld** and\n\nne⟧xt\n',
		mode: 'live',
		gesture: 'copy',
		expect: { clipboard: '**ld** and\n\nne' }
	},
	// ── Rulings at the land (2026-11-06) ──
	// § 5.4 rule 6: a line holding only spaces is blank already, so blocks pasted on it add none.
	{
		name: 'L9 blocks pasted on a line holding only spaces add no blank line',
		source: '  ⟦⟧\nafter\n',
		gesture: paste(' \n> q'),
		expect: { source: '  \n \n> q\nafter\n' }
	},
	{
		name: 'L9 the same blocks pasted after text take a blank line first',
		source: 'ab⟦⟧\n',
		gesture: paste(' \n> q'),
		expect: { source: 'ab\n\n \n> q\n' }
	},
	{
		name: 'L12 a cut from a code block text through its closing line pastes back exact with its entry',
		source: '```\nco⟦de\n```⟧\n\nafter\n',
		gesture: 'cut',
		expect: { source: '```\nco\n```\n\nafter\n', clipboard: 'de\n```', caret: text(6) },
		then: { gesture: 'paste back with own', expect: backToStart('```\ncode\n```\n\nafter\n') }
	},
	{
		name: 'L12 the same inside a quote',
		source: '> ```\n> co⟦de\n> ```⟧\n\nafter\n',
		gesture: 'cut',
		expect: { source: '> ```\n> co\n> ```\n\nafter\n', clipboard: 'de\n```', caret: text(10) },
		then: { gesture: 'paste back with own', expect: backToStart('> ```\n> code\n> ```\n\nafter\n') }
	},
	{
		name: 'L10 a cut that joins two items copies the bytes it took, markers included',
		source: '- a⟦\n- ⟧b\n',
		gesture: 'cut',
		expect: { source: '- ab\n', clipboard: '- \n- ', caret: text(3) },
		then: { gesture: 'paste back', expect: backToStart('- a\n- b\n') }
	},
	{
		name: 'L10 live, the cut that joins two items',
		source: '- a⟦\n- ⟧b\n',
		mode: 'live',
		gesture: 'cut',
		expect: { source: '- ab\n', clipboard: '- \n- ', caret: text(3) },
		then: { gesture: 'paste back', expect: backToStart('- a\n- b\n') }
	},
	{
		name: 'L12 that cut’s entry pasted at another caret lands as its text alone does',
		source: `${LONG}\n\n- a⟦\n- ⟧b\n\n${LONG}\n\n${LONG}\n`,
		gesture: 'cut',
		expect: { source: `${LONG}\n\n- ab\n\n${LONG}\n\n${LONG}\n`, clipboard: '- \n- ' },
		then: {
			gesture: 'paste back with own',
			at: `${LONG}\n\n- ab\n\n${LONG}`.length,
			expect: { source: `${LONG}\n\n- ab\n\n${LONG}\n\n- \n- \n\n${LONG}\n` }
		}
	},
	// ── The removal the editor runs from range stage 3 (law 4, spec § 5.2 and § 5.3) ──
	// Miss-analysis: every removal row ended in prose or entered a fence from prose, so a title row
	// left open, a body kept between, a live fence leaving and a quoted block's line went unseen.
	{
		name: 'C13 a cut from a title row out keeps the row closed, its closing tag after its text',
		source: '<details open>\n<summary>O⟦OOO</summary>\n\nPPPP\n\n</details>\n\nAA⟧AA\n',
		gesture: 'cut',
		expect: { source: '<details open>\n<summary>O</summary>\n</details>\nAA\n', caret: text(25) }
	},
	{
		name: 'L4 a cut into a fenced block takes the blocks before it, keeping only its opening',
		source: 'a⟦\n\nfoo\n\n```\nxy⟧\n```\n',
		gesture: 'cut',
		expect: { source: 'a\n\n```\n\n```\n', caret: text(1) }
	},
	{
		name: 'L4 a cut from a title row into the next titled container takes the body between',
		source:
			'<details open>\n<summary>O⟦OOO</summary>\n\nPPPP\n\n</details>\n\n<details>\n<summary>⟧SSSS</summary>\n\nHHHH\n\n</details>\n\nEEEE\n',
		gesture: 'cut',
		expect: {
			source:
				'<details open>\n<summary>O</summary>\n</details>\n\n<details>\n<summary>SSSS</summary>\n\nHHHH\n\n</details>\n\nEEEE\n',
			caret: text(25)
		}
	},
	{
		name: 'L10 live, a cut leaving a code block takes the text past it, the hidden closing line stays',
		source: '```\nx⟦\n```\nb⟧\n',
		mode: 'live',
		gesture: 'cut',
		expect: { source: '```\nx\n```\n\n', clipboard: '\n```\nb', caret: text(5) }
	},
	{
		name: 'L10 live, a range holding a code block whole from its first byte takes it, fences and all',
		source: '⟦```\n```⟧\n\npara\n',
		mode: 'live',
		gesture: 'cut',
		expect: { source: 'para\n', clipboard: '```\n```', caret: text(0) }
	},
	{
		name: 'L10 live, the same from inside its text',
		source: 'a\n\n```\nx⟦y\n```\nb⟧\n',
		mode: 'live',
		gesture: 'cut',
		expect: { source: 'a\n\n```\nx\n```\n\n', clipboard: 'y\n```\nb', caret: text(8) }
	},
	{
		name: 'L4 Backspace over a block held whole lands at the end of the block before',
		source: 'a\n\n⟦---⟧\n\nb\n',
		gesture: 'backspace',
		expect: { source: 'a\n\nb\n', caret: text(1) }
	},
	{
		name: 'L4 Delete over it lands at the start of what comes after',
		source: 'a\n\n⟦---⟧\n\nb\n',
		gesture: 'delete',
		expect: { source: 'a\n\nb\n', caret: text(3) }
	},
	// Miss-analysis: the rows beside a block held whole had prose neighbours only, whose every byte
	// takes a caret; a code block's fence lines take none.
	{
		name: 'L4 Backspace beside a code block lands at its body’s end, not on its closing line',
		source: '```\nx\n```\n\n⟦---⟧\n\nb\n',
		gesture: 'backspace',
		expect: { source: '```\nx\n```\n\nb\n', caret: text(5) }
	},
	{
		name: 'L4 Delete beside a code block lands at its body’s start, not on its opening line',
		source: 'a\n\n⟦---⟧\n\n```\nx\n```\n',
		gesture: 'delete',
		expect: { source: 'a\n\n```\nx\n```\n', caret: text(7) }
	},
	{
		name: 'L4 a block held whole behind a quote marker goes with its marker line, never nesting',
		source: '> a\n>\n> ⟦---⟧\n>\n> b\n',
		gesture: 'backspace',
		expect: { source: '> a\n>\n> b\n', caret: text(3) }
	},
	{
		name: 'L4 the same block alone in its quote leaves the quote emptied',
		source: 'a\n\n> ⟦---⟧\n\nb\n',
		gesture: 'backspace',
		expect: { source: 'a\n\n> \n\nb\n', caret: text(1) }
	},
	{
		name: 'L12 a block cut whole with a blank line pastes back exact with its entry',
		source: 'a\n\n⟦---⟧\n\nb\n',
		gesture: 'cut',
		expect: { source: 'a\n\nb\n', clipboard: '---', caret: text(3) },
		then: { gesture: 'paste back with own', expect: backToStart('a\n\n---\n\nb\n') }
	},
	{
		name: 'L3 the same as plain text pastes back as the same blocks, the blank line it took aside',
		source: 'a\n\n⟦---⟧\n\nb\n',
		gesture: 'cut',
		expect: { source: 'a\n\nb\n' },
		then: { gesture: 'paste back', expect: { source: 'a\n\n---\nb\n' } }
	},
	{
		name: 'L4 blocks held whole go with their lines and one of the blank lines either side',
		source: 'a\n\n⟦---\n\n---⟧\n\nb\n',
		gesture: 'delete',
		expect: { source: 'a\n\nb\n', caret: text(3) }
	},
	{
		name: 'L4 a range from a code block out past its closing line keeps that line',
		source: '```\nx⟦\n```\n\nb⟧b\n',
		gesture: 'backspace',
		expect: { source: '```\nx\n```\nb\n', caret: text(5) }
	},
	{
		name: 'L4 a fenced container left in a CRLF document keeps its closing line whole',
		source: ':::note\r\nalpha ⟦bravo\r\n:::\r\n\r\ndelta ⟧echo\r\n',
		gesture: 'cut',
		expect: { source: ':::note\r\nalpha echo\r\n:::\r\n', caret: text(15) }
	},
	{
		name: 'L4 the same out of a math block keeps its closing $$',
		source: '$$\nx⟦\n$$\n\nb⟧b\n',
		gesture: 'backspace',
		expect: { source: '$$\nx\n$$\nb\n', caret: text(4) }
	},
	{
		name: 'L4 the same in a CRLF document keeps the closing line before its line ending',
		source: '$$\r\nx⟦\r\n$$\r\n\r\nb⟧b\r\n',
		gesture: 'backspace',
		expect: { source: '$$\r\nx\r\n$$\r\nb\r\n', caret: text(5) }
	},
	{
		name: 'L4 a range starting past a code block keeps its closing line once',
		source: 'alpha\n\n```js\nbody\n```⟦\n\nom⟧ega\n',
		gesture: 'backspace',
		expect: { source: 'alpha\n\n```js\nbody\n```\nega\n', caret: text(21) }
	},
	// Miss-analysis: the closer rows all started inside the container, none at its closing line.
	{
		name: 'L4 a range starting past a fenced container keeps its closing line once',
		source: ':::note\nx\n:::⟦\n\nal⟧pha\n',
		gesture: 'backspace',
		expect: { source: ':::note\nx\n:::\npha\n' }
	},
	{
		name: 'L4 the same past a details block',
		source: '<details>\n<summary>S</summary>\n\nx\n</details>⟦\n\nal⟧pha\n',
		gesture: 'delete',
		expect: { source: '<details>\n<summary>S</summary>\n\nx\n</details>\npha\n' }
	},
	// ── The join writes through the start block's write rule (spec § 5.2, `host.leaf.join`) ──
	{
		name: 'C9 a setext heading the range starts in keeps its underline under the joined text',
		source: 'Set⟦ext\n======\n\nne⟧xt\n',
		gesture: 'backspace',
		expect: { source: 'Setxt\n======\n', caret: text(3) }
	},
	{
		name: 'C9 a setext title the range ends in loses its underline, the start keeps its own',
		source: 'Set⟦ext\n===\n\nOth⟧er\n---\n',
		gesture: 'backspace',
		expect: { source: 'Seter\n===\n', caret: text(3) }
	},
	{
		name: 'C9 a heading joined with a setext title below takes its text alone',
		source: '# Ti⟦tle\n\nOth⟧er\n---\n',
		gesture: 'delete',
		expect: { source: '# Tier\n', caret: text(4) }
	},
	{
		name: 'C9 a setext heading the range leaves for a block that takes no text keeps its underline',
		source: 'Set⟦ext\n===\n\n```\nco⟧de\n```\n',
		gesture: 'backspace',
		expect: { source: 'Set\n===\n\n```\nde\n```\n', caret: text(3) }
	},
	{
		name: 'L4 live, a join closes the run the start keeps and reopens the run the end keeps',
		source: 'a **b⟦old** b\n\nc *it⟧al* d\n',
		mode: 'live',
		gesture: 'backspace',
		expect: { source: 'a **b***al* d\n', caret: text(5) }
	},
	{
		name: 'L4 a join that makes a closing tag line in a section body writes it escaped',
		source:
			'<details>\n<summary>T</summary>\n\nalpha\n⟦beta\n\nxx⟧</details>\nmore\n\n</details>\n',
		gesture: 'backspace',
		expect: {
			source: '<details>\n<summary>T</summary>\n\nalpha\n&lt;/details>\nmore\n\n</details>\n'
		}
	},
	// ── A range entering a titled container keeps its opening (spec § 5.2, law 3's exception) ──
	{
		name: 'L4 a range into a title row keeps the opening line, the title losing what it covers',
		source: 'pa⟦ra\n\n:::note Ti⟧tle\nbody\n:::\n\nafter\n',
		gesture: 'backspace',
		expect: { source: 'pa\n\n:::note tle\nbody\n:::\n\nafter\n', caret: text(2) }
	},
	{
		name: 'L4 a range ending inside a container opening takes nothing of it',
		source: 'pa⟦ra\n\n:::⟧note Title\nbody\n:::\n\nafter\n',
		gesture: 'backspace',
		expect: { source: 'pa\n\n:::note Title\nbody\n:::\n\nafter\n', caret: text(2) }
	},
	// ── The blank line a block taken whole takes, at the document's edges and behind markers ──
	{
		name: 'L4 a block taken whole at the document start takes the blank line after it',
		source: '⟦---⟧\n\nafter\n',
		gesture: 'backspace',
		expect: { source: 'after\n', caret: text(0) }
	},
	{
		name: 'L4 a block taken whole at the document end leaves the blank line before it',
		source: 'lead\n\n⟦---⟧\n',
		gesture: 'backspace',
		expect: { source: 'lead\n\n', caret: text(4) }
	},
	{
		name: 'L4 Delete over a block taken whole behind a quote marker lands in the next quoted line',
		source: '> a\n>\n> ⟦---⟧\n>\n> b\n',
		gesture: 'delete',
		expect: { source: '> a\n>\n> b\n', caret: text(8) }
	},
	// ── A table the range enters or leaves keeps its header, and takes no prose into its rows ──
	{
		name: 'L4 a range entering a table below its header keeps the header and delimiter',
		source: 'intro⟦ paragraph\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n⟧| 3 | 4 |\n',
		gesture: 'backspace',
		expect: { source: 'intro\n\n| A | B |\n| --- | --- |\n| 3 | 4 |\n', caret: text(5) }
	},
	{
		name: 'L4 a range leaving a table from its body rows leaves the prose after it a block of its own',
		source: '| A | B |\n| --- | --- |\n⟦| 1 | 2 |\n| 3 | 4 |\n\nfollow ⟧paragraph\n',
		gesture: 'delete',
		expect: { source: '| A | B |\n| --- | --- |\n\nparagraph\n' }
	},
	// ── Ends that stay apart are each cut through their own block's write (spec § 5.11) ──
	{
		name: 'L4 live, a start kept apart from the end closes the run the range cuts',
		source: 'Some **bo⟦ld** text\n\n:::note T⟧itle\nbody\n:::\n',
		mode: 'live',
		gesture: 'backspace',
		expect: { source: 'Some **bo**\n\n:::note itle\nbody\n:::\n' }
	},
	{
		name: 'L4 live, an end kept apart from the start reopens the run the range cuts',
		source: 'Above\n\n:::note Ti⟦tle\nSome **bo⟧ld** text\n:::\n',
		mode: 'live',
		gesture: 'backspace',
		expect: { source: 'Above\n\n:::note Ti\n**ld** text\n:::\n' }
	},
	{
		name: 'C9 a setext heading the range starts in keeps its underline when the range ends past text',
		source: 'Set⟦ext\n===\n\nOther\n---⟧\n',
		gesture: 'backspace',
		expect: { source: 'Set\n===\n', caret: text(3) }
	},
	{
		name: 'L4 live, a range from a run through a table to its end closes the run',
		source: 'Some **bo⟦ld** text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |⟧\n',
		mode: 'live',
		gesture: 'backspace',
		expect: { source: 'Some **bo**\n' }
	},
	{
		name: 'L4 a quote the range holds from its first byte goes whole, with its line',
		source: 'lead\n\n⟦> quoted line⟧\n\ntail\n',
		gesture: 'cut',
		expect: { source: 'lead\n\ntail\n' }
	},
	{
		name: 'L4 a list item the range holds from its marker goes whole, with its line',
		source: '- one\n⟦- two⟧\n- three\n',
		gesture: 'delete',
		expect: { source: '- one\n- three\n' }
	},
	{
		name: 'L4 a block that is the whole document leaves its last line ending, its one empty line',
		source: '⟦---⟧\n',
		gesture: 'backspace',
		expect: { source: '\n', caret: text(0) }
	},
	{
		name: 'L4 a range from a block that takes no text to the document end adds no line',
		source: '    a\n\n⟦    b\n\nafter⟧',
		gesture: 'backspace',
		expect: { source: '    a\n\n' }
	},

	// ── What a removal leaves at the document's start and in a container's opening (e2e, 2026-11-09) ──
	{
		name: 'L4 a range from the document start to a rule it cannot join adds no line before it',
		source: '⟦| c |\n| - |\n\n⟧---\n',
		gesture: 'delete',
		expect: { source: '---\n', caret: { at: 0, holds: 'block' } }
	},
	{
		name: 'L4 a range from the document start into a list item it enters adds no line before it',
		source: '⟦| c |\n| - |\n\n- ⟧```js\n  body\n  ```\n',
		gesture: 'type',
		expect: { source: '- ```js\n  body\n  ```\n' }
	},
	{
		name: 'L4 a range from a table taken whole into a table body keeps the header first',
		source: '⟦| c |\n| - |\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n⟧| 3 | 4 |\n',
		gesture: 'delete',
		expect: { source: '| a | b |\n| --- | --- |\n| 3 | 4 |\n' }
	},
	{
		name: 'L4 a first paragraph the range empties keeps one empty line before a table body it enters',
		source: '⟦para\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n⟧| 3 | 4 |\n',
		gesture: 'delete',
		expect: { source: '\n| a | b |\n| --- | --- |\n| 3 | 4 |\n', caret: text(0) }
	},
	{
		name: 'L4 a title row a range starts in keeps its closing tag, its text emptied',
		source: 'Above\n\n<details open>\n<summary>⟦Sum</summary>\n\nShown⟧\n\n</details>\n\nMid\n',
		gesture: 'backspace',
		expect: { source: 'Above\n\n<details open>\n<summary></summary>\n\n\n</details>\n\nMid\n' }
	},
	{
		name: "L4 a range from a title row's opening syntax keeps the opening, its title emptied",
		source: 'Above\n\n⟦:::note Title\nBody⟧\n:::\n',
		gesture: 'delete',
		expect: { source: 'Above\n\n:::note \n\n:::\n' }
	},
	{
		name: 'L4 a block a range takes whole inside a container it enters goes with its line',
		source: 'Ab⟦ove\n\n:::note Title\n| a | b |\n| --- | --- |\n| 1 | 2 |⟧\n:::\n\nBelow\n',
		gesture: 'delete',
		expect: { source: 'Ab\n\n:::note Title\n:::\n\nBelow\n' }
	},
	{
		name: 'L4 a table taken whole, then one taken whole inside a container, keep only its opening',
		source:
			'⟦| a | b |\n| --- | --- |\n| 1 | 2 |\n\n:::note Title\n| c | d |\n| --- | --- |\n| 3 | 4 |⟧\n:::\n\nBelow\n',
		gesture: 'delete',
		expect: { source: ':::note Title\n:::\n\nBelow\n' }
	},

	// ── An emptied paragraph between blank lines keeps one empty line (owner question 1) ──
	{
		name: 'L4 the text of two paragraphs between blank lines leaves one empty line',
		source: 'Top\n\n⟦aa\n\nbb⟧\n\nNext\n',
		gesture: 'delete',
		expect: { source: 'Top\n\n\nNext\n', caret: text(5) }
	},
	{
		name: 'L3 that cut pastes back as the two paragraphs, apart from the one below',
		source: 'Top\n\n⟦aa\n\nbb⟧\n\nNext\n',
		gesture: 'cut',
		expect: { source: 'Top\n\n\nNext\n', clipboard: 'aa\n\nbb', caret: text(5) },
		then: { gesture: 'paste back', expect: backToStart('Top\n\naa\n\nbb\n\nNext\n') }
	},
	{
		name: 'L4 the same inside a quote keeps one quoted empty line',
		source: '> Top\n>\n> ⟦aa\n>\n> bb⟧\n>\n> Next\n',
		gesture: 'backspace',
		expect: { source: '> Top\n>\n> \n> Next\n', caret: text(10) }
	},
	{
		name: 'L4 the same at the document start, which counts as a blank line',
		source: '⟦aa\n\nbb⟧\n\nNext\n',
		gesture: 'delete',
		expect: { source: '\nNext\n', caret: text(0) }
	},
	{
		name: 'L4 a paragraph emptied up to a block taken whole leaves one empty line',
		source: 'Top\n\n⟦aa\n\n---⟧\n\nNext\n',
		gesture: 'delete',
		expect: { source: 'Top\n\n\nNext\n', caret: text(5) }
	},
	{
		name: 'L4 the same in a CRLF document',
		source: 'Top\r\n\r\n⟦aa\r\n\r\nbb⟧\r\n\r\nNext\r\n',
		gesture: 'delete',
		expect: { source: 'Top\r\n\r\n\r\nNext\r\n', caret: text(7) }
	},
	{
		name: 'L4 an emptied quoted paragraph above a line the quote ends on keeps that line',
		source: '> Top\n>\n> ⟦aa\n>\n> bb⟧\n\nNext\n',
		gesture: 'delete',
		expect: { source: '> Top\n>\n> \n\nNext\n' }
	},
	{
		name: 'L5 a word typed over that range stays apart from the paragraph below',
		source: 'Top\n\n⟦aa\n\nbb⟧\n\nNext\n',
		gesture: paste('x'),
		expect: { source: 'Top\n\nx\n\nNext\n', caret: text(6) }
	},
	{
		name: 'L5 two paragraphs pasted over it stay apart from the paragraph below',
		source: 'Top\n\n⟦aa\n\nbb⟧\n\nNext\n',
		gesture: paste('x\n\ny'),
		expect: { source: 'Top\n\nx\n\ny\n\nNext\n' }
	},
	{
		name: 'L5 plain text pasted over it stays apart too',
		source: 'Top\n\n⟦aa\n\nbb⟧\n\nNext\n',
		gesture: plain('*x*'),
		expect: { source: 'Top\n\n\\*x\\*\n\nNext\n' }
	},
	// Miss-analysis: every row above spans two blocks, so the write inside one never met the rule.
	{
		name: 'L4 one paragraph’s whole text leaves one empty line too',
		source: 'Top\n\n⟦aa⟧\n\nNext\n',
		gesture: 'delete',
		expect: { source: 'Top\n\n\nNext\n', caret: text(5) }
	},
	{
		name: 'L4 the text typed over it removed first, at the document start',
		source: '⟦Before⟧\n\nNext\n',
		gesture: 'type',
		expect: { source: '\nNext\n', caret: text(0) },
		then: { gesture: paste('x'), expect: { source: 'x\n\nNext\n' } }
	},

	// ── An end block that takes no joined text, entered by the range, stays a block ──
	{
		name: 'L3 a cut from a quote into an HTML block leaves its closing tag outside the quote',
		source: '> a⟦\n\n<div>\nb⟧\n</div>\n',
		gesture: 'cut',
		expect: { source: '> a\n</div>\n', caret: text(3) },
		then: { gesture: 'paste back', expect: backToStart('> a⟦\n\n<div>\nb⟧\n</div>\n') }
	},
	{
		name: 'L3 the same from a list item',
		source: '- a⟦\n\n<div>\nb⟧\n</div>\n',
		gesture: 'cut',
		expect: { source: '- a\n</div>\n', caret: text(3) },
		then: { gesture: 'paste back', expect: backToStart('- a⟦\n\n<div>\nb⟧\n</div>\n') }
	},
	{
		name: 'L4 the same into a script block, whose closing tag alone reads as its own block',
		source: '> a⟦\n\n<script>\nb⟧\n</script>\n',
		gesture: 'backspace',
		expect: { source: '> a\n</script>\n' }
	},
	{
		name: 'L4 text the range leaves on the HTML block’s line stays apart from the quote',
		source: '> a⟦\n\n<div>\nb⟧c\n</div>\n',
		gesture: 'delete',
		expect: { source: '> a\n\nc\n</div>\n' }
	},
	// ── A heading taken whole after a block that takes no joined text goes with its marker ──
	// Miss-analysis: the main draw never ended a range at a heading's text end from a closing line's
	// end; the HTML draw did, and a code block above does the same.
	{
		name: 'L4 from an HTML block’s last byte through a heading',
		source: '<div>\nx\n</div>⟦\n\n# head⟧\n',
		gesture: 'delete',
		expect: { source: '<div>\nx\n</div>\n' }
	},
	{
		name: 'L4 from a code block’s closing fence through a heading',
		source: '```\nx\n```⟦\n\n# head⟧\n',
		gesture: 'delete',
		expect: { source: '```\nx\n```\n' }
	},
	{
		name: 'L4 inside a quote, the quote’s markers kept',
		source: '> <div>\n> x\n> </div>⟦\n>\n> # head⟧\n>\n> after\n',
		gesture: 'delete',
		mode: 'live',
		expect: { source: '> <div>\n> x\n> </div>\n>\n> after\n' }
	},
	// ── Text over a range inside one cell is one write of the cell ──
	// Miss-analysis: the law draw draws no range inside a cell, and no row pasted over one.
	{
		name: 'L5 a paste over a word in a cell keeps the space after it, where a cut drops it',
		source: '| ⟦apple⟧ pie | b |\n| - | - |\n',
		gesture: paste('a|b'),
		expect: { source: '| a\\|b pie | b |\n| - | - |\n' }
	},
	{
		name: 'L11 and pasted as plain text, escaped as the cell reads Markdown',
		source: '| ⟦apple⟧ pie | b |\n| - | - |\n',
		gesture: plain('*x*'),
		expect: { source: '| \\*x\\* pie | b |\n| - | - |\n' }
	},
	// ── A paste over a range inside one block's text is one write of that block (law 5) ──
	// Miss-analysis: law 5 held every paste over a range to the cut then the paste, and a cut that
	// empties a line reads the block again as two, so no row asked the block to stay one.
	{
		name: 'L5 a paste over a quoted line’s text keeps the paragraph’s other lines its own',
		source: '> ⟦a⟧\n> b\n',
		gesture: paste('two words'),
		expect: { source: '> two words\n> b\n', caret: text(11) }
	},
	{
		name: 'L5 two paragraphs pasted over it stay in the quote, the second taking the lines after',
		source: '>\t⟦a⟧\n>\tb\n',
		gesture: paste('one\n\ntwo'),
		expect: { source: '>\tone\n>\n>\ttwo\n>\tb\n' }
	},
	{
		name: 'L5 a paragraph’s first line pasted over stays one paragraph with the rest',
		source: '⟦one⟧\ntwo\n',
		gesture: paste('two words'),
		expect: { source: 'two words\ntwo\n' }
	},
	{
		name: 'L5 live, a paste over a heading’s whole text keeps the heading',
		source: '# ⟦Title⟧\n',
		mode: 'live',
		gesture: paste('😀'),
		expect: { source: '# 😀\n' }
	},
	{
		name: 'L5 live, blocks pasted over it join the heading, as in source mode',
		source: '# ⟦Title⟧\n',
		mode: 'live',
		gesture: paste('one\n\ntwo'),
		expect: { source: '# one\n\ntwo\n' }
	},
	{
		name: 'L5 a heading pasted over a to-do’s text keeps its box and the list tight',
		source: '- [ ] ⟦a⟧\n- [x] b\n',
		gesture: paste('# h'),
		expect: { source: '- [ ] # h\n- [x] b\n' }
	},
	{
		name: 'L5 a heading pasted over a quoted paragraph’s text adds no line',
		source: '> ⟦q⟧\n# h\n',
		gesture: paste('# t'),
		expect: { source: '> # t\n# h\n' }
	},
	{
		name: 'L5 lines pasted over an item’s text on a last line with no ending stay in the item',
		source: '- ⟦xy⟧',
		gesture: paste('one\n\ntwo'),
		expect: { source: '- one\n\n  two' }
	},
	// Miss-analysis: law 9 leaves a caret in a heading to the rows, and none pasted a block there.
	{
		name: 'L9 blocks pasted in an emptied heading land under it, which keeps its marker',
		source: '> q\n# ⟦⟧\n',
		gesture: paste('- item'),
		expect: { source: '> q\n# \n\n- item\n', caret: text(14) }
	},
	{
		name: 'L5 live, blocks that join no text pasted over a heading’s whole text do the same',
		source: '# ⟦Title⟧\n',
		mode: 'live',
		gesture: paste('> q\n\nafter'),
		expect: { source: '# \n\n> q\n\nafter\n' }
	},
	{
		name: 'L9 blocks pasted at a cell’s text start go in on its one line, as its text',
		source: '| x | ⟦⟧y |\n| - | - |\n',
		gesture: paste('- q\n\n- r\n'),
		expect: { source: '| x | - q - ry |\n| - | - |\n' }
	},
	// ── A paste over a range writes the line ending its source had (§ 5.10) ──
	// Miss-analysis: the core read the ending after its removal, and every CRLF row left a line
	// ending standing for it to find.
	{
		name: 'L5 a paste over every line of a CRLF document writes CRLF',
		source: '⟦one\r\n\r\ntwo⟧',
		gesture: paste('a\nb'),
		expect: { source: 'a\r\nb' }
	},
	{
		name: 'L5 blocks pasted over them stay apart in CRLF too',
		source: '⟦one\r\n\r\ntwo⟧',
		gesture: paste('a\n\n# b\n'),
		expect: { source: 'a\r\n\r\n# b\r\n' }
	},
	{
		name: 'L3 the cut alone leaves no ending, so its text pasted back takes LF',
		source: '⟦one\r\n\r\ntwo⟧',
		gesture: 'cut',
		expect: { source: '' },
		then: { gesture: 'paste back', expect: { source: 'one\n\ntwo' } }
	},
	// ── An ordered list the removal shortens numbers on from where it was ──
	// Miss-analysis: the editor renumbered after the core, so no core row read the numbers shown.
	{
		name: 'L4 a range across ordered items numbers the items after it on',
		source: '1. o⟦ne\n2. t⟧wo\n3. three\n',
		gesture: 'delete',
		expect: { source: '1. owo\n2. three\n', caret: text(4) }
	},
	{
		name: 'L12 that cut pasted back with its entry gives the old numbers back',
		source: '1. o⟦ne\n2. t⟧wo\n3. three\n',
		gesture: 'cut',
		expect: { source: '1. owo\n2. three\n' },
		then: { gesture: 'paste back with own', expect: backToStart('1. one\n2. two\n3. three\n') }
	},
	{
		name: 'L4 a narrower number moves the item’s later lines to its text',
		source: '8. a⟦a\n9. b⟧b\n10. c\n\n    more\n',
		gesture: 'delete',
		expect: { source: '8. ab\n9. c\n\n   more\n' }
	},
	// ── The text after the range takes the place of a block taken whole, beside that block's siblings ──
	// Miss-analysis: the main draw never started a range at an HTML block first in a container with a
	// block flush above the container; the HTML draw's fresh seeds did.
	{
		name: 'L4 from an HTML block first in a quote: the quote keeps its line, flush under the list',
		source: '- # head\n\n- # head\n> ⟦</div>\n- o⟧ne\n  two\n',
		mode: 'live',
		gesture: 'cut',
		expect: { source: '- # head\n\n- # head\n> ne\n  two\n' }
	},
	{
		name: 'L4 the same from a list item’s first block under a quote, CRLF',
		source:
			'> <script>\r\n> </script>\r\n- ⟦<?php echo 1; ?>\r\n> <textarea>\r\n> ⟧left open\r\n- one\r\n',
		gesture: 'backspace',
		expect: { source: '> <script>\r\n> </script>\r\n- left open\r\n- one\r\n' }
	},
	{
		name: 'L4 the same from a second item, the list staying tight',
		source: '- a\n- ⟦</div>\n> o⟧ne\n',
		gesture: 'delete',
		expect: { source: '- a\n- ne\n' }
	},
	{
		name: 'L4 under a paragraph in the same quote, the pair it uncovers folds as one paragraph',
		source: 'a\n\n> para\n> ⟦</div>\n- o⟧ne\n',
		gesture: 'delete',
		expect: { source: 'a\n\n> para\n> ne\n' }
	},
	// ── The blank line that keeps two blocks apart takes their parent's markers (spec § 5.2) ──
	// Miss-analysis: every parting row kept two blocks apart inside one container or at the top,
	// never two containers whose lower one opens its line with a marker of its own.
	{
		name: 'L4 what is left of a third quote stays a quote of its own under the first',
		source:
			'> # h⟦ead\n\n> alpha bravo\n\n> <my⟧-element>\n> text\n> </my-element>\n<script>\nlet a = 1;\n</script>\n',
		gesture: 'cut',
		expect: {
			source: '> # h\n\n> -element>\n> text\n> </my-element>\n<script>\nlet a = 1;\n</script>\n'
		}
	},
	{
		name: 'L4 the quote left of a cut list item stays a quote of its own under the one above',
		source: '> x⟦\n\n- > a⟧b\n  > - d\n',
		gesture: 'backspace',
		expect: { source: '> xb\n\n  > - d\n' }
	},
	{
		name: 'L4 a line the text above still opens keeps its quote’s marker on the blank line before it',
		source: '> - x\n> y⟦\n\n- > 1.⟧ n\n  > m\n',
		gesture: 'backspace',
		expect: { source: '> - x\n>\n> y n\n  > m\n' }
	}
];
