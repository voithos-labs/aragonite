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
	'#818': 'alpha bravo\n\ncharlie delta\n'
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
