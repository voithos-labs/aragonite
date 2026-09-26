// A range with an endpoint on a closed details block's title row covers the hidden body, so its
// delete takes the whole block, from either side (#601); an open one keeps the wall rule.
// Miss-analysis: every wall-rule case used an open container, so no range endpoint ever sat on a
// title row whose body the reader could not see.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { rangeDelete } from '../../selection/range-delete';
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

function deleteRange(source: string, start: SelectionPoint, end: SelectionPoint) {
	return rangeDelete(parse(source), start, end, createSharingState(), fixtureReading());
}

// Every closed case removes the block whole, so what is left reloads to the same tree.
function run(source: string, start: SelectionPoint, end: SelectionPoint) {
	const result = deleteRange(source, start, end);
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

	it('at the title start, covering no visible byte: the block still goes whole', () => {
		const { source, caret } = run(
			'Above\n\n' + CLOSED + '\nMid\n',
			point([0], 5),
			point([1, 0], 0)
		);
		expect(source).toBe('Above\n\nMid\n');
		expect(caret).toEqual({ path: [0], offset: 5 });
	});
});

describe('an open details keeps the wall rule', () => {
	it('a range from its title row clears the title in place and keeps the block', () => {
		const result = deleteRange('Above\n\n' + OPEN + '\nMid\n', point([1, 0], 0), point([2], 0));
		expect(serialize(result.newDoc)).toBe(
			'Above\n\n<details open>\n<summary></summary>\n\n\n</details>\n\nMid\n'
		);
	});
});
