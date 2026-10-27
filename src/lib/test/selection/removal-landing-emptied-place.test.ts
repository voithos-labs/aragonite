// Text over a range that took the block it started in opens a paragraph where the range was when the
// caret the removal left sits on a block's syntax, and joins the block when that caret is on text.
// Miss-analysis: the landing rows asked only which block's keymap a command key reads, never whether
// text written at the landing caret lands inside its block's text or in front of its opener.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { rangeDelete } from '#lib/selection/cross-block/range-delete/range-delete.js';
import { emptiedPlace } from '#lib/selection/removal-landing.js';
import { fixtureReading } from '../harness/fixture-grammar';
import { writtenBelow } from '#lib/test/harness/settle-funnel.js';

const cell = (path: number[]): SelectionPoint => ({ path, offset: 0, cellCoordinate: true });
const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

/** The place `emptiedPlace` names once the range from `start` to `end` is deleted. */
function placeAfterRemoval(source: string, start: SelectionPoint, end: SelectionPoint) {
	const doc = parse(source);
	const coverage = rangeCoverage(doc, coverRange(doc, start, end));
	const removed = writtenBelow(
		doc,
		(scope) => rangeDelete(doc, coverage, scope, fixtureReading(), 'keyless'),
		fixtureReading().grammar
	);
	const caret = removed.caret(removed.newDoc);
	if (!caret) throw new Error('the removal left no caret');
	return emptiedPlace(removed.newDoc, coverage, 'delete', caret);
}

const TABLE = '| c |\n| - |\n\n';
const TWO_TABLES = '| c |\n| - |\n\n| d |\n| - |\n';

describe('a range from a table held whole to the first byte of the block below', () => {
	const OPENS: Array<[string, string, number[]]> = [
		['an ATX heading', '# Head', [1]],
		['a fenced code block', '```js\nbody\n```', [1]],
		['an HTML block', '<div>\nhi\n</div>', [1]],
		['an indented code block', '    code', [1]],
		['a rule', '---', [1]],
		['a fenced code block opening a list item', '- ```js\n  body\n  ```', [1, 0, 0]]
	];
	for (const [name, block, end] of OPENS) {
		it(`opens a paragraph before ${name}`, () => {
			expect(placeAfterRemoval(`${TABLE}${block}\n`, cell([0]), at(end, 0))).toEqual([0]);
		});
	}

	const JOINS: Array<[string, string, number[]]> = [
		['a paragraph', 'plain', [1]],
		['a setext heading', 'Head\n===', [1]],
		["a quote's paragraph", '> q', [1, 0]],
		["a list item's paragraph", '- li', [1, 0, 0]]
	];
	for (const [name, block, end] of JOINS) {
		it(`joins ${name}`, () => {
			expect(placeAfterRemoval(`${TABLE}${block}\n`, cell([0]), at(end, 0))).toBeNull();
		});
	}
});

describe('a range holding every block after the one above it', () => {
	it('opens a paragraph after a fenced code block, whose end is its closing fence', () => {
		const source = `\`\`\`js\nbody\n\`\`\`\n\n${TWO_TABLES}`;
		expect(placeAfterRemoval(source, cell([1]), cell([2]))).toEqual([1]);
	});

	it('opens a paragraph after a rule', () => {
		expect(placeAfterRemoval(`---\n\n${TWO_TABLES}`, cell([1]), cell([2]))).toEqual([1]);
	});

	it("joins a heading at its text's end", () => {
		expect(placeAfterRemoval(`# Head\n\n${TWO_TABLES}`, cell([1]), cell([2]))).toBeNull();
	});
});

describe('a range whose start block survives', () => {
	it('keeps its caret where the range started, even beside a fence', () => {
		expect(placeAfterRemoval('alpha\n\n```js\nbody\n```\n', at([0], 2), at([1], 0))).toBeNull();
	});
});
