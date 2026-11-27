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
