// The documents the range-edit laws run over: the property suites' own generators for nested
// quotes and lists, tables, fences, plugin containers, live-mode runs and CRLF, beside the behavior
// corpus, the filed repros and the picture paragraphs no generator draws.

import fc from 'fast-check';
import type { PresentationMode } from '#lib/presentation-mode.js';
import {
	arbBlankSeparatedGfmDoc,
	arbLiveDoc,
	arbRespelledContainerDoc,
	arbRespelledPluginContainerDoc
} from '../invariants/arbitraries/index';
import { arbFencedBodyDoc } from '../invariants/arbitraries/plugin-syntax';
import { FLUSH_JOIN_DOCUMENTS, SMALL_DOCUMENTS } from '../behavior/corpus';

/** The filed repros, by issue. */
export const ISSUE_DOCUMENTS = {
	'#815':
		'alpha bravo charlie\n\n> Ithaka\n> By C. P. Cavafy\n> > As you set out for Ithaka\n> > hope your road is a long one,\n',
	'#816': '- i0\n  - i1\n    - i2\n  - i3\n    - i4\n\n    p5\n',
	'#817': 'alpha\n\nbeta\n\n![pic](p.png)\n',
	'#818': 'alpha bravo\n\ncharlie delta\n',
	'#826':
		'<details>\n<summary>Sum</summary>\n\nbody\n\n</details>\n\npara\n\n:::note\n<details>\n<summary>Sum</summary>\n\nbody\n\n</details>\n\npara\n:::\n\nabc\n\n<details open>\n<summary>Sum</summary>\n\nbody\n\n</details>\n\n# h\n'
} as const;

const PICTURES = [
	'![pic](p.png)\n',
	'text\n\n![pic](p.png)\n',
	'![a](a.png) between ![b](b.png)\n\nafter\n',
	'> ![q](q.png)\n>\n> quoted\n',
	'- ![i](i.png)\n- item\n'
];

const FIXTURES = [
	...Object.values(SMALL_DOCUMENTS),
	...Object.values(FLUSH_JOIN_DOCUMENTS),
	...Object.values(ISSUE_DOCUMENTS),
	...PICTURES
];

/** A document the editor opens, weighted toward the shapes a person writes. */
export const arbLawDocument: fc.Arbitrary<string> = fc.oneof(
	{ arbitrary: fc.constantFrom(...FIXTURES), weight: 4 },
	{ arbitrary: arbBlankSeparatedGfmDoc, weight: 2 },
	{ arbitrary: arbRespelledContainerDoc, weight: 2 },
	{ arbitrary: arbRespelledPluginContainerDoc, weight: 1 },
	{ arbitrary: arbFencedBodyDoc, weight: 1 },
	{ arbitrary: arbLiveDoc, weight: 1 }
);

/** An HTML block of each of the seven types, as lines: closed, spanning a blank line, left open. */
const HTML_BLOCKS: string[][] = [
	['<script>', 'let a = 1;', '</script>'],
	['<pre>', 'code', '', 'more', '</pre>'],
	['<style>p { color: red; }</style>'],
	['<textarea>', 'left open'],
	['<!-- a note -->'],
	['<!--', 'a', '', 'b', '-->'],
	['<?php echo 1; ?>'],
	['<!DOCTYPE html>'],
	['<![CDATA[', 'x < y', ']]>'],
	['<div>', '*not emphasis*', '</div>'],
	['<div>'],
	['</div>'],
	['<table><tr><td>cell</td></tr></table>'],
	['<span class="x">'],
	['</a>'],
	['<my-element>', 'text', '</my-element>']
];

const PROSE: string[][] = [['alpha bravo'], ['one', 'two'], ['**bold** and `code`'], ['# head']];

/** A block, or one inside a quote or a list item, its later lines indented under the marker. */
const arbHtmlPart: fc.Arbitrary<string[]> = fc
	.tuple(
		fc.oneof({ arbitrary: fc.constantFrom(...HTML_BLOCKS), weight: 2 }, fc.constantFrom(...PROSE)),
		fc.constantFrom('', '> ', '- ')
	)
	.map(([[first, ...rest], marker]) => {
		const under = (l: string) =>
			marker === '> ' ? (l === '' ? '>' : `> ${l}`) : l === '' || marker === '' ? l : `  ${l}`;
		return [`${marker}${first}`, ...rest.map(under)];
	});

/** Documents built around HTML blocks, two to four parts apart by a blank line or touching. */
export const arbHtmlLawDocument: fc.Arbitrary<string> = fc
	.record({
		parts: fc.array(fc.tuple(arbHtmlPart, fc.boolean()), { minLength: 2, maxLength: 4 }),
		eol: fc.constantFrom('\n', '\n', '\r\n')
	})
	.map(({ parts, eol }) =>
		parts
			.flatMap(([lines, touching], i) => (i === 0 || touching ? lines : ['', ...lines]))
			.map((line) => line + eol)
			.join('')
	);

export const arbMode = fc.constantFrom<PresentationMode>('source', 'live');

/** The document's line endings, a column of every report. */
export function endingOf(source: string): 'lf' | 'crlf' | 'mixed' {
	const crlf = (source.match(/\r\n/g) ?? []).length;
	const lf = (source.match(/\n/g) ?? []).length - crlf;
	if (crlf === 0) return 'lf';
	return lf === 0 ? 'crlf' : 'mixed';
}

/** Clipboard text to paste or type: a word, Markdown that reads as structure, several blocks. */
export const arbClipboardText: fc.Arbitrary<string> = fc.oneof(
	fc.constantFrom('x', 'two words', '汉字', '😀'),
	fc.constantFrom(
		'# not a heading',
		'- item',
		'1. one',
		'> quoted',
		'**bold** and `code`',
		'| a | b |'
	),
	fc.constantFrom('a\nb', 'line one\nline two\n'),
	fc.constantFrom('one\n\ntwo', 'para\n\n- a\n- b\n', '> q\n\nafter', '```\ncode\n```\n')
);

const RUNS: readonly (readonly [open: string, close: string])[] = [
	['**', '**'],
	['__', '__'],
	['*', '*'],
	['_', '_'],
	['~~', '~~'],
	['[', '](u)'],
	['**x _', '_ y**'],
	['*x __', '__ y*'],
	['[x __', '__ y](u)']
];

/** A paragraph whose format run holds the caret (`‸`), with blocks to paste there: lists and a
 *  quote whose last line the run's second half lands behind, and blocks it lands under. */
export const arbRunPaste: fc.Arbitrary<{ marked: string; text: string }> = fc
	.record({
		lead: fc.constantFrom('', '> ', '- ', '1. ', '# ', '- [ ] '),
		run: fc.constantFrom(...RUNS),
		inner: fc.constantFrom('bold', 'two words', '汉字é', 'a (b) c'),
		at: fc.double({ min: 0, max: 1, noNaN: true }),
		text: fc.constantFrom(
			'- q\n- r',
			'1. q\n2. r',
			'> q\n>\n> r',
			'one\n\n- a\n- b',
			'- q\n- r\n',
			'one\n\ntwo',
			'| a |\n| - |',
			'> q\n\nafter'
		)
	})
	.map(({ lead, run: [open, close], inner, at, text }) => {
		const chars = [...inner];
		const cut = 1 + Math.min(Math.floor(at * (chars.length - 1)), chars.length - 2);
		const [before, after] = [chars.slice(0, cut).join(''), chars.slice(cut).join('')];
		return { marked: `${lead}a ${open}${before}‸${after}${close} z\n`, text };
	});

// ── A block between two neighbours ───────────────────────────────────────────

/** The lines above the taken block and below it, which its removal leaves touching. */
export const NEIGHBOURS: Record<string, { upper: string[]; lower: string[] }> = {
	tableHalves: { upper: ['| a |', '| - |', '| 1 |'], lower: ['| 2 |'] },
	tableRows: { upper: ['| a |', '| - |', '| 1 |', '| 3 |'], lower: ['| 2 |'] },
	indentedCode: { upper: ['    a'], lower: ['    b'] },
	htmlBlocks: { upper: ['<!-- a -->'], lower: ['<div>', 'x'] },
	htmlUnderText: { upper: ['text'], lower: ['<span class="x">'] },
	setextUnderline: { upper: ['text'], lower: ['==='] },
	lazyQuote: { upper: ['> quoted'], lower: ['lazy'] },
	lazyItem: { upper: ['- item'], lower: ['lazy'] },
	startedTitle: { upper: ['[a]: /u', "    'code"], lower: ['text', "end'"] },
	paragraphs: { upper: ['above'], lower: ['below'] }
};
/** The block between them, which a range takes. */
export const MIDDLES: Record<string, string[]> = {
	heading: ['# h'],
	rule: ['***'],
	fence: ['```', 'x', '```']
};

/** `NEIGHBOURS` with a block between, at top level, in a quote or in an item, under a paragraph. */
export const arbNeighbourDocument: fc.Arbitrary<string> = fc
	.record({
		shape: fc.constantFrom(...Object.values(NEIGHBOURS)),
		middle: fc.constantFrom(...Object.values(MIDDLES)),
		marker: fc.constantFrom(['', ''], ['> ', '> '], ['- ', '  ']),
		eol: fc.constantFrom('\n', '\r\n')
	})
	.map(({ shape, middle, marker, eol }) => {
		const lines = [...shape.upper, ...middle, ...shape.lower];
		const body = lines.map((line, i) => (i ? marker[1] : marker[0]) + line);
		return ['intro', '', ...body, '', 'last', ''].join(eol);
	});
