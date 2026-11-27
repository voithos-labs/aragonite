// @vitest-environment jsdom
// Miss-analysis: every byte renumber row was a list counting up by one, where stepping by one
// writes the bytes the author wrote, and no row ended a removal inside an item from above the list.
// The renumber rule over the range-edit core's routes: removal, cut and paste number on from the
// edit, keeping the step of the list's first two numbers.
import { describe, it, expect } from 'vitest';
import { editRange, type Gesture } from '#lib/range-edit/edit-range.js';
import {
	SPELLINGS,
	expectedMarkers,
	topMarkers
} from '../editor-actions/ordered-renumber-spellings';
import { checkHost } from './test-host';

const listOf = (markers: string[]) =>
	['aa', 'bb', 'cc', 'dd'].map((t, i) => `${markers[i]} ${t}`).join('\n') + '\n';

/** The byte where `text` ends in `source`. */
const after = (source: string, text: string) => source.indexOf(text) + text.length;

const paste = (text: string): Gesture => ({ paste: text, plain: false, holds: 'text' });

const ROWS: {
	gesture: string;
	from: number;
	items: number;
	range: (source: string) => { from: number; to: number };
	run: Gesture;
}[] = [
	{
		gesture: 'Delete over b whole',
		from: 1,
		items: 3,
		range: (s) => ({ from: after(s, 'aa'), to: after(s, 'bb') }),
		run: 'delete'
	},
	{
		gesture: 'cut over b whole',
		from: 1,
		items: 3,
		range: (s) => ({ from: after(s, 'aa'), to: after(s, 'bb') }),
		run: 'cut'
	},
	{
		gesture: 'Delete from a into b',
		from: 1,
		items: 3,
		range: (s) => ({ from: after(s, 'aa'), to: s.indexOf('bb') }),
		run: 'delete'
	},
	{
		gesture: 'pasting two items at the end of b',
		from: 2,
		items: 5,
		range: (s) => ({ from: after(s, 'bb'), to: after(s, 'bb') }),
		run: paste('1. x\n2. y')
	},
	{
		gesture: 'pasting a line and its ending at the end of b, as Enter there',
		from: 2,
		items: 5,
		range: (s) => ({ from: after(s, 'bb'), to: after(s, 'bb') }),
		run: paste('x\n')
	},
	// At the end of a the edit reaches the list's second item, so only a read before it holds.
	{
		gesture: 'pasting two items at the end of a',
		from: 1,
		items: 5,
		range: (s) => ({ from: after(s, 'aa'), to: after(s, 'aa') }),
		run: paste('1. x\n2. y')
	},
	{
		gesture: 'pasting two items and their ending at the end of a',
		from: 1,
		items: 6,
		range: (s) => ({ from: after(s, 'aa'), to: after(s, 'aa') }),
		run: paste('1. x\n2. y\n')
	},
	{
		gesture: 'pasting a line and its ending at the end of a',
		from: 1,
		items: 5,
		range: (s) => ({ from: after(s, 'aa'), to: after(s, 'aa') }),
		run: paste('x\n')
	}
];

describe('a range edit numbers on as the author wrote', () => {
	for (const row of ROWS) {
		describe(row.gesture, () => {
			it.each(SPELLINGS)('%s', (spelling) => {
				const markers = spelling.split(' ');
				const source = listOf(markers);
				const out = editRange(source, row.range(source), row.run, 'source', checkHost());
				expect(topMarkers(out.source)).toEqual(expectedMarkers(markers, row.from, row.items));
			});
		});
	}
});

// Miss-analysis: the spelling rows were four top-level items with LF endings, so no CRLF, missing
// final ending, one-item, two-item, lazy or quoted nested list met a removal or a paste.
describe('the byte routes keep the rule over other list shapes', () => {
	const removeB = (s: string) => ({ from: s.search(/\r?\n[^\n]*bb/), to: after(s, 'bb') });
	const atEnd = (text: string) => (s: string) => ({ from: after(s, text), to: after(s, text) });
	it.each([
		['CRLF, b removed', '1. aa\r\n1. bb\r\n1. cc\r\n', removeB, 'delete', '1. aa\r\n1. cc\r\n'],
		[
			'CRLF, Enter pasted at b',
			'1. aa\r\n1. bb\r\n1. cc\r\n',
			atEnd('bb'),
			paste('x\n'),
			'1. aa\r\n1. bbx\r\n1. \r\n1. cc\r\n'
		],
		['no final ending, b removed', '1. aa\n1. bb\n1. cc', removeB, 'cut', '1. aa\n1. cc'],
		[
			'no final ending, Enter pasted at the last item',
			'1. aa\n1. bb',
			atEnd('bb'),
			paste('x\n'),
			'1. aa\n1. bbx\n1. \n'
		],
		['one item, Enter pasted', '3. aa\n', atEnd('aa'), paste('x\n'), '3. aax\n4. \n'],
		[
			'1. 1., Enter pasted at a',
			'1. aa\n1. bb\n',
			atEnd('aa'),
			paste('x\n'),
			'1. aax\n1. \n1. bb\n'
		],
		[
			'lazy line above, b removed',
			'1. aa\nlazy\n1. bb\n1. cc\n',
			removeB,
			'delete',
			'1. aa\nlazy\n1. cc\n'
		],
		[
			'quoted nested, b removed',
			'> - top\n>   1. aa\n>   1. bb\n>   1. cc\n',
			removeB,
			'delete',
			'> - top\n>   1. aa\n>   1. cc\n'
		],
		[
			'quoted nested, Enter pasted at b',
			'> - top\n>   1. aa\n>   1. bb\n>   1. cc\n',
			atEnd('bb'),
			paste('x\n'),
			'> - top\n>   1. aa\n>   1. bbx\n>   1. \n>   1. cc\n'
		]
	] as const)('%s', (_name, source, range, gesture, out) => {
		expect(editRange(source, range(source), gesture as Gesture, 'source', checkHost()).source).toBe(
			out
		);
	});
});

// The item holding the removal's end survives as the list's first item, so it takes the start.
describe('a removal from above a list into an item', () => {
	it.each([
		['9. a\n10. bbb\n11. c\n', '9. bb\n10. c\n'],
		['1. a\n1. bbb\n1. c\n', '1. bb\n1. c\n']
	])('%j', (list, rest) => {
		const source = '```\ncode\n```\n\n' + list;
		const out = editRange(
			source,
			{ from: after(source, 'co'), to: after(source, 'b') },
			'delete',
			'source',
			checkHost()
		);
		expect(out.source.slice(out.source.indexOf('\n', out.source.indexOf('```', 4)) + 1)).toContain(
			rest
		);
	});
});

// Miss-analysis: every held row had nothing of its list above the range and an item after the held
// one, so a held item under a kept item, or ending its list, never took its number.
describe('an item the removal ends inside numbers on wherever it sits', () => {
	it.each([
		{
			name: 'under an item the range starts in',
			source: '1. a\n\n   ```\n   code\n   ```\n2. b\n3. ccc\n4. d\n',
			rest: '   ```\n2. cc\n3. d\n'
		},
		{
			name: 'as the last item of its list',
			source: '```\ncode\n```\n\n9. a\n10. bbb\n',
			rest: '```\n9. bb\n'
		}
	])('$name', ({ source, rest }) => {
		const range = { from: after(source, 'co'), to: source.search(/b{3}|c{3}/) + 1 };
		const out = editRange(source, range, 'delete', 'source', checkHost()).source;
		expect(out.slice(-rest.length)).toBe(rest);
	});
});

// The marker on the line the tail joins is the start line's own, so the item left leading the
// list takes the start.
describe('a removal whose tail joins a line holding its own marker', () => {
	it.each([
		{
			name: 'from an item into its sublist',
			source: '1. outer\n   1. xx\n   2. yy\n',
			range: (s: string) => ({ from: after(s, 'ou'), to: after(s, '1. x') }),
			out: '1. oux\n   1. yy\n'
		},
		{
			name: 'from one list into the next',
			source: '1. only\n\n1) cc\n2) dd\n',
			range: (s: string) => ({ from: after(s, 'on'), to: after(s, '1) c') }),
			out: '1. onc\n\n1) dd\n'
		},
		{
			name: 'from a paragraph into an item’s later line',
			source: 'pp\n\n1. a\n2. bb\n\n   more\n3. c\n',
			range: (s: string) => ({ from: after(s, 'p'), to: after(s, 'mo') }),
			out: null
		}
	])('$name', ({ source, range, out }) => {
		const got = editRange(source, range(source), 'delete', 'source', checkHost()).source;
		if (out) expect(got).toBe(out);
		else expect(topMarkers(got)[0]).toBe('1.');
	});
});
