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
		name: 'L3 a code block held whole goes with its line',
		source: '⟦```\ncode();\n```⟧\n\n| H0 |\n| --- |\n',
		gesture: 'cut',
		expect: { source: '\n| H0 |\n| --- |\n', clipboard: '```\ncode();\n```' },
		then: { gesture: 'paste back', expect: backToStart('```\ncode();\n```\n\n| H0 |\n| --- |\n') }
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
	{
		name: 'C5 a range from mid-paragraph into an item first line keeps the item marker',
		source: 'p⟦q\n\n- a⟧b\n\n  c\n',
		gesture: 'backspace',
		expect: { source: 'pb\n\n- c\n', caret: text(1) }
	},
	{
		name: 'C5 a list item keeps its marker when the range takes its first line',
		source: 'p⟦\n\n- a⟧\n\n  b\n',
		gesture: 'backspace',
		expect: { source: 'p\n\n- b\n', caret: text(1) }
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
	// ── Rulings at the land (2026-11-06) ──
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
	}
];
