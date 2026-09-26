// The caret-reachable order over closed details, tables and nested lists, beside the coverage
// order select-all keeps: a closed body is invisible to one and covered by the other.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import {
	firstCaretLeaf,
	firstCaretLeafFrom,
	lastCaretLeaf,
	lastPath,
	nextCaretPath,
	previousCaretPath
} from '../../selection/path-lookup';
import { registerChromePluginsForTests } from './chrome-plugins';

const CLOSED = '<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n';
const OPEN = '<details open>\n<summary>Sum</summary>\n\nShown\n\n</details>\n';

// [0] Above, [1] the closed details ([1,0] title row, [1,1] hidden body), [2] Below.
const SANDWICH = 'Above\n\n' + CLOSED + '\nBelow\n';

beforeEach(registerChromePluginsForTests);

describe('a closed details is its title row', () => {
	const doc = () => parse(SANDWICH);

	it('both edges of the block are the title row', () => {
		expect(firstCaretLeaf(doc(), [1])).toEqual([1, 0]);
		expect(lastCaretLeaf(doc(), [1])).toEqual([1, 0]);
	});

	it('forward from above stops on the title row, then steps past the body', () => {
		expect(nextCaretPath(doc(), [0])).toEqual([1, 0]);
		expect(nextCaretPath(doc(), [1, 0])).toEqual([2]);
	});

	it('backward from below stops on the title row, then steps out above it', () => {
		expect(previousCaretPath(doc(), [2])).toEqual([1, 0]);
		expect(previousCaretPath(doc(), [1, 0])).toEqual([0]);
	});

	it('a path already inside the hidden body walks out to the title row or past the block', () => {
		expect(previousCaretPath(doc(), [1, 1])).toEqual([1, 0]);
		expect(nextCaretPath(doc(), [1, 1])).toEqual([2]);
	});

	it('the coverage order still reaches the hidden body', () => {
		expect(lastPath(parse('Above\n\n' + CLOSED))).toEqual([1, 1]);
		expect(lastCaretLeaf(parse('Above\n\n' + CLOSED), [1])).toEqual([1, 0]);
	});

	it('an open details walks its body like any container', () => {
		const open = parse('Above\n\n' + OPEN + '\nBelow\n');
		expect(lastCaretLeaf(open, [1])).toEqual([1, 1]);
		expect(nextCaretPath(open, [1, 0])).toEqual([1, 1]);
		expect(previousCaretPath(open, [2])).toEqual([1, 1]);
	});

	it('a closed details nested in an open one hides only its own body', () => {
		const nested = parse(
			'<details open>\n<summary>Outer</summary>\n\nBody\n\n' + CLOSED + '\n</details>\n\nBelow\n'
		);
		expect(lastCaretLeaf(nested, [0])).toEqual([0, 2, 0]);
		expect(nextCaretPath(nested, [0, 2, 0])).toEqual([1]);
	});
});

describe('tables and nested lists', () => {
	// [0] x, [1] the table (row 0 the header, row 1 the body), [2] y.
	const table = () => parse('x\n\n| a | b |\n| - | - |\n| c | d |\n\ny\n');

	it('a table descends table, row, cell', () => {
		expect(firstCaretLeaf(table(), [1])).toEqual([1, 0, 0]);
		expect(lastCaretLeaf(table(), [1])).toEqual([1, 1, 1]);
		expect(nextCaretPath(table(), [1, 0, 1])).toEqual([1, 1, 0]);
		expect(previousCaretPath(table(), [2])).toEqual([1, 1, 1]);
	});

	it('a first child steps back to the leaf before its container, never to the container', () => {
		const list = parse('top\n\n- a\n  - b\n    - c\n');
		expect(previousCaretPath(list, [1, 0, 0])).toEqual([0]);
		expect(previousCaretPath(list, [1, 0, 1, 0, 1, 0, 0])).toEqual([1, 0, 1, 0, 0]);
		expect(lastCaretLeaf(list, [1])).toEqual([1, 0, 1, 0, 1, 0, 0]);
	});
});

describe('firstCaretLeafFrom', () => {
	it('reads a slot one past the end of its list as the next block out', () => {
		const doc = parse('> a\n\nb\n');
		expect(firstCaretLeafFrom(doc, [0, 1])).toEqual([1]);
		expect(firstCaretLeafFrom(doc, [2])).toBeNull();
	});

	it('skips a slot inside a closed body', () => {
		expect(firstCaretLeafFrom(parse(SANDWICH), [1, 1])).toEqual([2]);
	});
});
