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
const paste = (t: string): Gesture => ({ paste: t, plain: false });
const plain = (t: string): Gesture => ({ paste: t, plain: true });
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
	// as Backspace at the item's start does (`structural-edits.md` § Delete).
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
		name: 'L10 live, the same',
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
		name: 'L4 a range starting past a code block keeps its closing line once',
		source: 'alpha\n\n```js\nbody\n```⟦\n\nom⟧ega\n',
		gesture: 'backspace',
		expect: { source: 'alpha\n\n```js\nbody\n```\nega\n', caret: text(21) }
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
		name: 'L4 a block taken whole at the document end takes its line ending too',
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
	}
];
