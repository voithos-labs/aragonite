// A range ending on the first byte of a block its start's block can't join stops at the text
// before that block, so the blank lines between stay and the block keeps its own line.
// Miss-analysis: removals were only driven into blocks that join, so no row met a rule's edge.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { rangeBytes, rangePaint } from '#lib/selection/range-bytes.js';
import { classifyBlockForSelection } from '#lib/selection/primitives.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { deleteRange } from '../harness/range-delete';

function read(source: string, start: SelectionPoint, end: SelectionPoint) {
	const doc = parse(source);
	const coverage = rangeCoverage(doc, coverRange(doc, start, end));
	const layout = documentLayout(doc);
	const range = rangeBytes(doc, coverage, layout)!;
	const paint = rangePaint(doc, coverage, layout);
	const removed = parse(source);
	deleteRange(removed, start, end, { gesture: 'Backspace' });
	return {
		bytes: source.slice(range.from, range.to),
		paint: [start.path, end.path].map((path) => classifyBlockForSelection(path, paint)),
		removed: serialize(removed)
	};
}

describe('a range ending on the edge of a block its start cannot join', () => {
	it.each([
		['a rule', 'alpha\n\n---\n', 'al\n\n---\n'],
		['a rule inside a quote', 'alpha\n\n> ---\n', 'al\n\n> ---\n'],
		['a code block', 'alpha\n\n```\ncode\n```\n', 'al\n\n```\ncode\n```\n'],
		['a heading', 'alpha\n\n# Head\n', 'al\n\n# Head\n']
	])('%s: stops at the text before it', (_, source, removed) => {
		const end = source.includes('> ') ? [1, 0] : [1];
		expect(read(source, { path: [0], offset: 2 }, { path: end, offset: 0 })).toEqual({
			bytes: 'pha',
			paint: ['start', 'end'],
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

	it('runs on into a block that joins', () => {
		expect(read('alpha\n\nbeta\n', { path: [0], offset: 2 }, { path: [1], offset: 0 })).toEqual({
			bytes: 'pha\n\n',
			paint: ['start', 'end'],
			removed: 'albeta\n'
		});
	});
});
