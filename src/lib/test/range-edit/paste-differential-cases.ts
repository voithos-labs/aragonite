// The paste differential's named cases: one per entry a paste comes in by, and one per shape a
// ruling or an issue names, so each cluster has a row that labels it. `‸` marks a caret and `⟦ ⟧`
// a range in a case's source; each resolves on the tree the editor opens.

import type { Document } from '#lib/core/nodes.js';
import type { EditorSelection } from '#lib/selection/primitives.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import type { Mode } from '#lib/range-edit/host.js';
import type { DiffRoute, PasteCase, Place } from './paste-differential';

/** Every route a text paste at a caret or over a range comes in by. */
const TEXT_ROUTES: DiffRoute[] = ['key', 'menu', 'insertMarkdown', 'plain menu', 'shift key'];

interface Named {
	name: string;
	marked: string;
	clips: string[];
	modes?: Mode[];
	routes?: DiffRoute[];
	/** A place the marks can't say: a block focused whole, the gap caret, a cell rectangle. */
	via?: Place;
}

const CRLF = (text: string) => text.replace(/\n/g, '\r\n');
const ITHAKA =
	'alpha ⟦bravo charlie\n\n> Ithaka\n> By C. P. Cavafy\n> > As you ⟧set out for Ithaka\n> > hope your road is a long one,\n';

const NAMED: Named[] = [
	// ── At a caret in text ──
	{
		name: 'mid-paragraph',
		marked: 'alpha ‸bravo\n',
		clips: ['x', 'one\n\ntwo', '# T\nbody', '- item', 'line one\nline two\n', 'x\n', '**b**']
	},
	{ name: '#436 at a line end, a line below', marked: 'abc‸\nAfter\n', clips: ['x\n\ny'] },
	{ name: '#623 at a heading text start', marked: '# ‸Hi\n', clips: ['abc\n\ndef'] },
	{ name: '#554 a heading pasted mid-word', marked: 'ab‸cd\n', clips: ['# T\nbody'] },
	{ name: 'gate 2, a quote into a quote', marked: '> a‸b\n', clips: ['> q', '> q\n\n> r\n'] },
	{ name: 'gate 3, a list into a list', marked: '- a‸b\n', clips: ['- q', '- q\n- r\n'] },
	{ name: 'gate 4, a bullet into an ordered list', marked: '1. a‸b\n2. c\n', clips: ['- q\n- r'] },
	{ name: 'C8, one line after text', marked: 'para ‸text\n', clips: ['* c', '# h', '> q', '1. x'] },
	{
		name: 'gate 7, a trailing line ending',
		marked: 'abc‸\n\nnext\n',
		clips: ['x\n', 'line one\nline two\n', 'one\n\ntwo\n']
	},
	{ name: 'an empty paragraph above a fence', marked: '‸\n```\nx\n```\n', clips: ['x', 'a\n\nb'] },
	{ name: 'a lazy quote line', marked: '> a\nla‸zy\n', clips: ['x\n\ny'] },
	{ name: '#819 a footnote line', marked: '  [^n]: ‸a\n', clips: ['line one\nline two\n'] },
	{
		name: '#819 hidden bold before the caret',
		marked: 'a **b**‸\n',
		clips: ['x'],
		modes: ['live']
	},
	{ name: '#819 after an autolink', marked: '<http://a.b>‸\n', clips: ['1. one'], modes: ['live'] },
	{ name: '#819 an empty quote line', marked: '> [!NOTE]\n>‸\n>\n> two words\n', clips: ['a\nb'] },
	{
		name: '#819 mixed line endings',
		marked: '- a\r\n  - x\n\r\n  a‸\n\r\n  a\n> q\r\n',
		clips: ['a\nb']
	},
	{
		name: 'CRLF, a clipboard of CRLF lines',
		marked: CRLF('one\n\ntwo‸\n'),
		clips: ['a\r\nb', 'p\r\n\r\nq\r\n']
	},
	{
		name: 'a GitHub alert, which a transform rewrites',
		marked: '‸\n',
		clips: ['> [!NOTE]\n> body\n']
	},
	{ name: 'a GitHub alert after text', marked: 'para ‸x\n', clips: ['> [!NOTE]'] },
	// ── In a code block, a math block, a table cell ──
	{
		name: 'a fenced code body',
		marked: '```\nco‸de\n```\n',
		clips: ['x', '```\ninner\n```\n', '# T', 'a\n\nb']
	},
	{ name: 'an indented code body', marked: '    co‸de\n', clips: ['# not a heading', 'a\nb'] },
	{ name: 'a math block', marked: '$$\nx‸\n$$\n', clips: ['y', '$$\n'] },
	{
		name: 'a table cell',
		marked: '| a‸ | b |\n| - | - |\n| 1 | 2 |\n',
		clips: ['x', 'one\ntwo', 'one\n\ntwo', '| p | q |\n| - | - |\n| 3 | 4 |']
	},
	{ name: 'a range inside one cell', marked: '| a⟦bc⟧ | b |\n| - | - |\n', clips: ['x', 'p\nq'] },
	{
		name: 'a rectangle of cells',
		marked: '| a | b |\n| - | - |\n| 1 | 2 |\n',
		clips: ['x', '| p | q |\n| - | - |\n| 3 | 4 |'],
		via: {
			anchor: { path: [0], offset: 0, cellCoordinate: true },
			focus: { path: [0], offset: 3, cellCoordinate: true }
		}
	},
	// ── In a plugin's block ──
	{ name: 'a callout body', marked: ':::note\nbo‸dy\n:::\n', clips: ['x', 'one\n\ntwo'] },
	{ name: 'a callout title row', marked: ':::note Ti‸tle\nbody\n:::\n', clips: ['x\ny', 'a\n\nb'] },
	{ name: 'a callout body a delete emptied', marked: ':::note\n‸\n:::\n', clips: ['xy', 'a\n\nb'] },
	{
		name: 'a details summary',
		marked: '<details>\n<summary>S‸S</summary>\n\nbody\n\n</details>\n',
		clips: ['a\n\nb']
	},
	// ── Over a range ──
	{
		name: '#818 two paragraphs',
		marked: 'alpha ⟦bravo\n\ncharlie ⟧delta\n',
		clips: ['X', 'p\n\nq']
	},
	{ name: 'a range in one paragraph', marked: 'al⟦ph⟧a\n', clips: ['x', 'one\n\ntwo'] },
	{
		name: 'a table held whole',
		marked: 'a\n\n| t | u |\n| - | - |\n| 1 | 2 |\n\nb\n',
		clips: ['x', 'one\n\ntwo'],
		via: {
			anchor: { path: [1], offset: 0, cellCoordinate: true },
			focus: { path: [1], offset: 3, cellCoordinate: true }
		}
	},
	// ── A block focused whole, the gap caret, the root ──
	{
		name: 'a rule focused whole',
		marked: 'a\n\n---\n\nb\n',
		clips: ['x', 'one\n\ntwo'],
		via: { whole: [1] },
		routes: ['key']
	},
	{
		name: 'the gap caret between a table and a fence',
		marked: '| a |\n| - |\n\n```\nx\n```\n\nplain\n',
		clips: ['x', 'one\n\ntwo'],
		via: { gap: { parentPath: [], index: 1 } },
		routes: ['key']
	},
	{
		name: 'the gap caret above a table',
		marked: '| a |\n| - |\n',
		clips: ['x'],
		via: { gap: { parentPath: [], index: 0 } },
		routes: ['key']
	},
	{
		name: 'the gap caret in a quote above its table',
		marked: '> | a |\n> | - |\n\nplain\n',
		clips: ['x'],
		via: { gap: { parentPath: [0], index: 0 } },
		routes: ['key']
	},
	{
		name: 'the gap caret at a quote’s end, under its table',
		marked: '> | a |\n> | - |\n\nplain\n',
		clips: ['x'],
		via: { gap: { parentPath: [0], index: 1 } },
		routes: ['key']
	},
	{ name: 'an empty document', marked: '‸', clips: ['x', 'one\n\ntwo'] },
	// ── A cut, then a paste of it back ──
	{
		name: '#818 cut and paste back',
		marked: 'alpha ⟦bravo\n\ncharlie ⟧delta\n',
		clips: [''],
		routes: ['cut then key', 'cut then plain']
	},
	{ name: '#815 cut and paste back', marked: ITHAKA, clips: [''], routes: ['cut then key'] },
	{
		name: 'a cut across paragraphs, pasted back as plain text',
		marked: 'a\n\nbr⟦avo\n\ncharlie\n⟧',
		clips: [''],
		routes: ['cut then key', 'cut then plain']
	},
	{
		name: 'a cut from a quote through a fence to a paragraph',
		marked: '> ⟦q\n\n```\nx\n```\n\npa⟧ra\n',
		clips: [''],
		routes: ['cut then key']
	},
	{
		name: 'a cut of the whole document',
		marked: '| H0 | H1 |\n| --- | --- |\n\nplain words',
		clips: [''],
		routes: ['cut then key'],
		via: {
			anchor: { path: [0], offset: 0, cellCoordinate: true },
			focus: { path: [1], offset: 11 }
		}
	},
	{
		name: 'a rule focused whole above a code block, cut and pasted back',
		marked: 'para\n\n---\n\n```\ncode\n```\n',
		clips: [''],
		via: { whole: [1] },
		routes: ['cut then key']
	}
];

/** `marked`'s caret or range on the tree `source` opens to. */
function placeOf(doc: Document, marked: string): EditorSelection | null {
	const layout = documentLayout(doc);
	const clean = (at: number) => marked.slice(0, at).replace(/[‸⟦⟧]/g, '').length;
	const caret = marked.indexOf('‸');
	const source = marked.replace(/[‸⟦⟧]/g, '');
	// A mark on a marker or a blank line takes the nearest text place on its line.
	const at = (byte: number) => {
		const lineStart = source.lastIndexOf('\n', byte - 1) + 1;
		const lineEnd = source.indexOf('\n', byte) < 0 ? source.length : source.indexOf('\n', byte);
		for (let b = byte; b <= lineEnd; b++) if (layout.pointAt(b)) return layout.pointAt(b);
		for (let b = byte; b >= lineStart; b--) if (layout.pointAt(b)) return layout.pointAt(b);
		return byte === 0 ? { path: [0], offset: 0 } : null;
	};
	if (caret >= 0) {
		const point = at(clean(caret));
		return point && { anchor: point, focus: point };
	}
	const [from, to] = [at(clean(marked.indexOf('⟦'))), at(clean(marked.indexOf('⟧')))];
	return from && to ? { anchor: from, focus: to } : null;
}

export function namedCases(grammar: GrammarView): PasteCase[] {
	return NAMED.flatMap((named) => {
		const source = named.marked.replace(/[‸⟦⟧]/g, '');
		const doc = readAsOpened(source, { grammar, scope: 'document' }) as Document;
		const via = named.via ?? placeOf(doc, named.marked);
		// A mark the tree gives no text place (an empty quote line) has no case.
		if (!via) return [];
		return (named.modes ?? (['source', 'live'] as const)).flatMap((mode) =>
			(named.routes ?? TEXT_ROUTES).flatMap((route) =>
				named.clips.map((clip) => ({ name: named.name, source, mode, via, clip, route }))
			)
		);
	});
}
