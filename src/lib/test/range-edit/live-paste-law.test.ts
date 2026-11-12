// @vitest-environment jsdom
// Law 9 in live mode, pinned: a paste at a caret in a format run must leave the run closed, and
// each shape the split itself leaves as a literal cut is declared by that shape and no wider.
// Miss-analysis: law 5 strips delimiters before it compares, so a run left open on both halves of
// a pasted block boundary broke no law.

import { describe, expect, it } from 'vitest';
import { editRange } from '#lib/range-edit/edit-range.js';
import { shownDelimiters } from './expected';
import { pasteAtCaret, type Call } from './laws';
import { checkHost } from './test-host';

const TABLE = '| a |\n| - |';
const caretOf = (marked: string, text: string) => ({
	source: marked.replace('‸', ''),
	at: marked.indexOf('‸'),
	mode: 'live' as const,
	held: { holds: 'text' as const },
	text
});

describe('law 9 in live mode', () => {
	const OPEN: [name: string, marked: string, cutByBytes: string, text?: string][] = [
		['a bold run', 'a **bo‸ld** z\n', 'a **bo\n\n| a |\n| - |\n\nld** z\n'],
		['a link', 'a [bo‸ld](u) z\n', 'a [bo\n\n| a |\n| - |\n\nld](u) z\n'],
		['a code span', 'a `bo‸ld` z\n', 'a `bo\n\n| a |\n| - |\n\nld` z\n'],
		['an underscore run', 'a __bo‸ld__ z\n', 'a __bo\n\n| a |\n| - |\n\nld__ z\n'],
		[
			'a half behind an item’s last line',
			'a __bo‸ld__ z\n',
			'a __bo\n\n- q\n- rld__ z\n',
			'- q\n- r'
		]
	];
	for (const [name, marked, cutByBytes, text = TABLE] of OPEN) {
		it(`reds on ${name} pasted blocks leave open`, () => {
			const literal: Call = () => ({ source: cutByBytes, caret: { at: 0, holds: 'text' } });
			expect(pasteAtCaret(literal, checkHost(), caretOf(marked, text))).not.toEqual([]);
		});
	}

	// Each declared shape with a neighbour just outside it, which the law still holds.
	const DECLARED: [name: string, marked: string, text: string, held: string][] = [
		['a code span cut beside a backtick', 'a ``b`‸c`` z\n', TABLE, 'a ``b‸c`` z\n'],
		['an image’s alt text', 'a ![al‸t](i.png) z\n', TABLE, 'a [al‸t](i.png) z\n'],
		['three delimiters in a row', 'a ***b‸c*** *d*\n', 'one\n\ntwo', 'a **b‸c** *d*\n'],
		[
			'a caret between two delimiters, where no live caret stands',
			'a *‸*bc** z\n',
			TABLE,
			'a **b‸c** z\n'
		],
		[
			'a half on punctuation behind an item’s last letter',
			'a **bo‸(ld)** z\n',
			'- q\n- r',
			'a **bo‸ld** z\n'
		],
		[
			'a run in a run of its own kind behind an item’s last letter',
			'a *b _c‸d_ e* z\n',
			'- q\n- r',
			'a **b _c‸d_ e** z\n'
		]
	];
	for (const [name, marked, text, held] of DECLARED) {
		it(`says nothing of ${name}, and holds the place beside it`, () => {
			const host = checkHost();
			const call: Call = (source, range, gesture, mode) =>
				editRange(source, range, gesture, mode, host);
			expect(pasteAtCaret(call, host, caretOf(marked, text))).toEqual([]);
			expect(pasteAtCaret(call, host, caretOf(held, text))).toEqual([]);
			const beside = caretOf(held, text);
			const open: Call = (source) => ({
				source: source.slice(0, beside.at) + '\n\n' + text + '\n\n' + source.slice(beside.at),
				caret: { at: 0, holds: 'text' }
			});
			expect(pasteAtCaret(open, host, beside)).not.toEqual([]);
		});
	}

	it('a declared literal cut really shows the run’s delimiters', () => {
		const host = checkHost();
		const got = editRange(
			'a ``b`c`` z\n',
			{ from: 6, to: 6 },
			{ paste: TABLE, plain: false, holds: 'text' },
			'live',
			host
		);
		expect(shownDelimiters(host, got.source)).toBeGreaterThan(
			shownDelimiters(host, 'a ``b`xc`` z\n')
		);
	});
});
