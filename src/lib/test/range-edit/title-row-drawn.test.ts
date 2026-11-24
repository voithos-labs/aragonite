// @vitest-environment jsdom
// Miss-analysis: the whole-text rule's rows read the bytes a live delete over a title row leaves,
// never the core's copy of the same range, which kept the `:::name` the row's own write left alone.
import { describe, expect, it } from 'vitest';
import { copyRange, removalOf } from '#lib/range-edit/edit-range.js';
import { checkHost } from './test-host';

/** Each kind's titled row, with the byte its row starts at. */
const ROWS: [kind: string, source: string, row: number][] = [
	['a callout', ':::tip Title\nbody\n:::\n', 0],
	['a generic container', ':::foo Title\nbody\n:::\n', 0],
	['a callout in a quote', '> :::tip Title\n> body\n> :::\n', 2],
	['a callout in a list item', '- :::tip Title\n  body\n  :::\n', 2],
	['the inner row of a nested callout', '::::note Outer\n:::tip Inner\nin\n:::\n::::\n', 15]
];

/** Live ranges over the row's whole title, as offsets from the row's first byte: the row whole,
 *  from inside the name, the title alone. A range that stays inside the name is not one of them. */
const RANGES: [string, number, number][] = [
	['the row whole', 0, 12],
	['from inside the name', 3, 12],
	['the title', 7, 12]
];

describe("a live range over a title row's whole text: the copy holds the title the removal takes", () => {
	for (const [kind, source, row] of ROWS)
		for (const [name, a, b] of RANGES)
			it(`${kind}, ${name}`, () => {
				const range = { from: row + a, to: row + b };
				const { clipboard } = copyRange(source, range, 'live', checkHost());
				expect(clipboard).toBe(source.slice(row + 7, row + 12));
				const left = removalOf(source, range, 'cut', 'live', checkHost()).source;
				expect(left).toBe(source.slice(0, row + 7) + source.slice(row + 12));
			});
});
