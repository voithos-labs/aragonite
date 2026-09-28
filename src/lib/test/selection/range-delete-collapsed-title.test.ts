// A range with an endpoint on a closed details block's title row covers the hidden body, so its
// delete takes the whole block, from either side; an open one keeps the wall rule.
// Miss-analysis: GH #601; every wall-rule case used an open container, never a hidden body.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { rangeDelete } from '../../selection/range-delete';
import { coverRange } from '../../selection/range-coverage';
import { createSharingState } from '../../tree-operations/sharing';
import type { SelectionPoint } from '../../selection/primitives';
import { fixtureReading } from '../harness/fixture-grammar';
import { expectParseConverged } from '../harness/parse-converged';
import { registerChromePluginsForTests } from './chrome-plugins';

const CLOSED = '<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n';
const OPEN = '<details open>\n<summary>Sum</summary>\n\nShown\n\n</details>\n';

function point(path: number[], offset: number): SelectionPoint {
	return { path, offset };
}

// Whatever the delete leaves has to reload to the same tree.
function run(source: string, start: SelectionPoint, end: SelectionPoint) {
	const doc = parse(source);
	const result = rangeDelete(
		doc,
		coverRange(doc, start, end),
		createSharingState(),
		fixtureReading()
	);
	expectParseConverged(result.newDoc);
	return { source: serialize(result.newDoc), caret: result.collapsedCaret };
}

beforeEach(registerChromePluginsForTests);

describe('a range starting on a closed title row', () => {
	// [0] Above, [1] the details ([1,0] its title row), [2] Mid.
	const DOC = 'Above\n\n' + CLOSED + '\nMid\n';

	it('from the title start: the block goes whole and the caret lands where the range began', () => {
		const { source, caret } = run(DOC, point([1, 0], 0), point([2], 0));
		expect(source).toBe('Above\n\nMid\n');
		expect(caret).toEqual({ path: [1], offset: 0 });
	});

	it('from inside the title: the block still goes whole, the end keeps its tail', () => {
		const { source, caret } = run(DOC, point([1, 0], 1), point([2], 1));
		expect(source).toBe('Above\n\nid\n');
		expect(caret).toEqual({ path: [1], offset: 0 });
	});

	it('a closed details nested in an open one goes, and the outer one stays', () => {
		const outer =
			'<details open>\n<summary>Outer</summary>\n\nBody\n\n' + CLOSED + '\n</details>\n';
		const { source, caret } = run(outer + '\nBelow\n', point([0, 2, 0], 0), point([1], 0));
		expect(source).toBe(
			'<details open>\n<summary>Outer</summary>\n\nBody\n\n</details>\n\nBelow\n'
		);
		expect(caret).toEqual({ path: [1], offset: 0 });
	});

	it('select-all over a document that is one closed details leaves an empty document', () => {
		const { source, caret } = run(CLOSED, point([0, 0], 0), point([0, 1], 6));
		expect(source).toBe('\n');
		expect(caret).toEqual({ path: [0], offset: 0 });
	});
});

describe('a range ending on a closed title row', () => {
	it('Mod+Shift+End into a document ending in one: the block goes whole', () => {
		const { source, caret } = run('Above\n\n' + CLOSED, point([0], 0), point([1, 0], 3));
		expect(source).toBe('\n');
		expect(caret).toEqual({ path: [0], offset: 0 });
	});

	// A delete never removes what the selection doesn't visibly reach.
	it('at the title start, covering no visible character: nothing is deleted', () => {
		const source = 'Above\n\n' + CLOSED + '\nMid\n';
		const result = run(source, point([0], 5), point([1, 0], 0));
		expect(result.source).toBe(source);
		expect(result.caret).toEqual({ path: [0], offset: 5 });
	});
});

// Miss-analysis: GH #659; the closed-title rows all put the other endpoint in prose, so the table
// branch, which had no hidden-body rule of its own, was never run with one.
describe('the table branch takes a closed details whole too', () => {
	const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';
	const cell = (path: number[], index: number): SelectionPoint => ({
		path,
		offset: index,
		cellCoordinate: true
	});

	it('a start on the title row with the end in a table below', () => {
		const { source } = run('Above\n\n' + CLOSED + '\n' + TABLE, point([1, 0], 1), cell([2], 1));
		expect(source).toBe('Above\n\n| 1 | 2 |\n| --- | --- |\n');
	});

	it('an end on the title row with the start in a table above', () => {
		const { source } = run(TABLE + '\n' + CLOSED + '\nBelow\n', cell([0], 2), point([1, 0], 1));
		expect(source).toBe('| a | b |\n| --- | --- |\n\nBelow\n');
	});
});

// Miss-analysis: GH #605; the wall-rule suite asserted bytes only, never an emptied body's shape.
describe('an open details keeps the wall rule', () => {
	it('a range from its title row empties the block to its title, and it reloads the same', () => {
		const { source, caret } = run('Above\n\n' + OPEN + '\nMid\n', point([1, 0], 0), point([2], 0));
		expect(source).toBe('Above\n\n<details open>\n<summary></summary>\n</details>\n\nMid\n');
		expect(caret).toEqual({ path: [1, 0], offset: 0 });
	});

	it('a range from above into the title row keeps the body and its wrap', () => {
		const { source } = run('Above\n\n' + OPEN + '\nMid\n', point([0], 2), point([1, 0], 3));
		expect(source).toBe(
			'Ab\n\n<details open>\n<summary></summary>\n\nShown\n\n</details>\n\nMid\n'
		);
	});
});
