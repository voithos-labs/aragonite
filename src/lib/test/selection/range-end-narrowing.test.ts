// A range ending on the first byte of a block its start's block can't join stops at the text
// before that block, so the blank lines between stay and the block keeps its own line.
// Miss-analysis: removals were only driven into blocks that join, so no row met a rule's edge.
import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { rangeBytes, rangePaint } from '#lib/selection/range-bytes.js';
import { classifyBlockForSelection, endpointMeasureSpan } from '#lib/selection/primitives.js';
import { SELECTION_END } from '#lib/block-component.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { deleteRange } from '../harness/range-delete';
import { registerChromePluginsForTests } from './chrome-plugins';
import { measured } from '#lib/tree-operations/top-level-starts.js';

beforeEach(registerChromePluginsForTests);

const layoutOf = (doc: ReturnType<typeof parse>) => documentLayout(measured(doc));

function read(source: string, start: SelectionPoint, end: SelectionPoint) {
	const doc = parse(source);
	const coverage = rangeCoverage(doc, coverRange(doc, start, end));
	const layout = layoutOf(doc);
	const range = rangeBytes(doc, coverage, layout)!;
	const paint = rangePaint(doc, coverage, layout);
	const removed = parse(source);
	deleteRange(removed, start, end, { gesture: 'Backspace' });
	return {
		bytes: source.slice(range.from, range.to),
		paint: [start.path, end.path].map((path) => classifyBlockForSelection(path, paint)),
		spans: [start.path, end.path].map((path) => {
			const { from, to } = endpointMeasureSpan(classifyBlockForSelection(path, paint), coverage);
			return [from, to];
		}),
		removed: serialize(removed)
	};
}

describe('a range ending on the edge of a block its start cannot join', () => {
	it.each([
		['a rule', 'alpha\n\n---\n', 'al\n\n---\n'],
		['a rule inside a quote', 'alpha\n\n> ---\n', 'al\n\n> ---\n'],
		['a code block', 'alpha\n\n```\ncode\n```\n', 'al\n\n```\ncode\n```\n'],
		['a heading', 'alpha\n\n# Head\n', 'al\n\n# Head\n']
	])('%s: stops at the text before it, painted as taken', (_, source, removed) => {
		const end = source.includes('> ') ? [1, 0] : [1];
		expect(read(source, { path: [0], offset: 2 }, { path: end, offset: 0 })).toEqual({
			bytes: 'pha',
			paint: ['start', 'end'],
			spans: [
				[2, SELECTION_END],
				[0, 0]
			],
			removed
		});
	});

	it('stops at the end of a block with no text before it', () => {
		const source = 'alpha\n\n---\n\n---\n';
		expect(read(source, { path: [0], offset: 2 }, { path: [2], offset: 0 })).toMatchObject({
			bytes: 'pha\n\n---',
			removed: 'al\n\n---\n'
		});
	});

	it('stops at the end of a table before it, never inside its last row', () => {
		const source = 'alpha\n\n| a |\n| - |\n| 1 |\n\n---\n';
		expect(read(source, { path: [0], offset: 2 }, { path: [2], offset: 0 })).toMatchObject({
			bytes: 'pha\n\n| a |\n| - |\n| 1 |'
		});
	});

	it('stops before a section whose title row it would end on', () => {
		const source = 'MMMM\n\n<details>\n<summary>SSSS</summary>\n\nHHHH\n\n</details>\n';
		expect(read(source, { path: [0], offset: 1 }, { path: [1, 0], offset: 0 })).toMatchObject({
			bytes: 'MMM',
			removed: 'M\n\n<details>\n<summary>SSSS</summary>\n\nHHHH\n\n</details>\n'
		});
	});

	it('runs on into a block that joins', () => {
		expect(read('alpha\n\nbeta\n', { path: [0], offset: 2 }, { path: [1], offset: 0 })).toEqual({
			bytes: 'pha\n\n',
			paint: ['start', 'end'],
			spans: [
				[2, SELECTION_END],
				[0, 0]
			],
			removed: 'albeta\n'
		});
	});
});

// Miss-analysis: the ends this file narrowed all stopped after a block ending in its last text,
// never one whose closing line or hidden body comes after.
describe('a block the range holds whole goes whole, the end narrowed or not', () => {
	const CLOSED = '<details>\n<summary>Sum</summary>\n\nbody\n\n</details>';
	it.each([
		['out of a closed summary', `${CLOSED}\n\npara\n`, [0, 0], [1], CLOSED, 'para\n'],
		['out of a closed summary, to a heading', `${CLOSED}\n\n# h\n`, [0, 0], [1], CLOSED, '# h\n'],
		[
			'out of a closed summary in a quote',
			'> <details>\n> <summary>Sum</summary>\n>\n> body\n>\n> </details>\n>\n> para\n',
			[0, 0, 0],
			[0, 1],
			'<details>\n> <summary>Sum</summary>\n>\n> body\n>\n> </details>',
			'> para\n'
		],
		[
			'out of a closed summary in a directive',
			`:::note\n${CLOSED}\n\npara\n:::\n`,
			[0, 1, 0],
			[0, 2],
			CLOSED,
			':::note\n\npara\n:::\n'
		]
	])('%s: takes the details with its hidden body', (_, source, from, to, bytes, removed) => {
		const start = { path: from, offset: 1 };
		const end = { path: to, offset: 0 };
		expect(read(source, start, end)).toMatchObject({ bytes, removed });
		// The details paints as one box, the summary inside it.
		const doc = parse(source);
		const paint = rangePaint(doc, rangeCoverage(doc, coverRange(doc, start, end)), layoutOf(doc));
		expect(paint.boxHolding(from)).toEqual(from.slice(0, -1));
	});

	it.each([
		['an open details', '<details open>\n<summary>Sum</summary>\n\nbody\n\n</details>', '# h'],
		['a closed details', CLOSED, '# h'],
		['a directive', ':::note\nbody\n:::', '---'],
		['a quote ending in a blank line', '> body\n>', '```\nz\n```']
	])('%s between a paragraph and a block it cannot join goes whole', (_, block, after) => {
		const source = `abc\n\n${block}\n\n${after}\n`;
		expect(read(source, { path: [0], offset: 1 }, { path: [2], offset: 0 })).toMatchObject({
			bytes: `bc\n\n${block}`,
			removed: `a\n\n${after}\n`
		});
	});

	it('an open summary keeps its container: the body goes, the details stays', () => {
		const source = '<details open>\n<summary>Sum</summary>\n\nbody\n\n</details>\n\npara\n';
		expect(read(source, { path: [0, 0], offset: 1 }, { path: [1], offset: 0 })).toMatchObject({
			bytes: 'um</summary>\n\nbody'
		});
	});
});
