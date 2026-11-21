// A paste over a range that took the block it started in lands where text over the range goes: in a
// paragraph of its own where the range was when the block below opens with syntax, else joined to
// the text below at its first byte; a start block the range kept takes it after its kept text. The
// bytes are written out by hand, so a place the core gets wrong for text and paste alike shows here.
// Miss-analysis: law 5 set a paste across blocks beside the core's own place for text, the one
// answer both share, so a wrong place moved both and no unit row saw it.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { editRange } from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { removalBytes } from '#lib/selection/range-bytes.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { fixtureReading } from '../harness/fixture-grammar';
import { noTransforms } from './test-host';

const cell = (path: number[], offset = 0): SelectionPoint => ({
	path,
	offset,
	cellCoordinate: true
});
const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

/** What a paste of `ж` over the range from `start` to `end` of `source` leaves. */
function pasted(source: string, start: SelectionPoint, end: SelectionPoint): string {
	const doc = parse(source);
	const laid = measured(doc);
	const layout = documentLayout(laid);
	const range = removalBytes(doc, rangeCoverage(doc, coverRange(doc, start, end)), layout);
	if (!range) throw new Error('no bytes for the range');
	const host = noTransforms(rangeHost(fixtureReading(), { source, measured: laid, layout }));
	const gesture = { paste: 'ж', plain: true, holds: 'text' as const };
	return editRange(serialize(doc), range, gesture, 'source', host).source;
}

const TABLE = '| c |\n| - |\n\n';

describe('a range from a table held whole to the first byte of the block below', () => {
	it.each([
		['an ATX heading', '# Head', [1]],
		['a fenced code block', '```js\nbody\n```', [1]],
		['an HTML block', '<div>\nhi\n</div>', [1]],
		['an indented code block', '    code', [1]],
		['a rule', '---', [1]],
		['a fenced code block opening a list item', '- ```js\n  body\n  ```', [1, 0, 0]]
	])('stands in a paragraph of its own before %s', (_, block, end) => {
		expect(pasted(`${TABLE}${block}\n`, cell([0]), at(end, 0))).toBe(`ж\n\n${block}\n`);
	});

	it.each([
		['a paragraph', 'plain', [1], 'жplain'],
		['a setext heading', 'Head\n===', [1], 'жHead\n==='],
		// The range holds the marker, which every removal over it takes.
		["a quote's paragraph", '> q', [1, 0], 'жq'],
		["a list item's paragraph", '- li', [1, 0, 0], 'жli']
	])('joins %s', (_, block, end, landed) => {
		expect(pasted(`${TABLE}${block}\n`, cell([0]), at(end, 0))).toBe(`${landed}\n`);
	});
});

describe('a range holding every block after the one above it', () => {
	it.each([['```js\nbody\n```'], ['---'], ['# Head']])('stands after %j', (above) => {
		const source = `${above}\n\n| c |\n| - |\n\n| d |\n| - |\n`;
		expect(pasted(source, cell([1]), cell([2]))).toBe(`${above}\n\nж\n`);
	});
});

describe('a range whose start block survives', () => {
	it('takes the text after its kept text, even beside a fence', () => {
		expect(pasted('alpha\n\n```js\nbody\n```\n', at([0], 2), at([1], 0))).toBe(
			'alж\n\n```js\nbody\n```\n'
		);
	});
});
