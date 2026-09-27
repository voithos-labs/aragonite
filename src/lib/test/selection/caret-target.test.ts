// Resolving a landing position to a leaf, and picking the survivor after a removal, on the tree
// alone: containers descend by their entry edge, closed bodies become their title row.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import type { CstNode, Document } from '../../core/nodes';
import { nodeAt } from '../../tree-operations/node-primitives';
import {
	CURSOR_END,
	CURSOR_EXACT_START,
	CURSOR_START,
	FOCUS_LAST_START
} from '../../block-component';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { caretTargetFor, survivorAfterRemoval } from '../../selection/caret-target';
import { registerChromePluginsForTests } from './chrome-plugins';

const CLOSED = '<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n';

function removeChildAt(doc: Document, path: number[]): Document {
	const parent = nodeAt(doc, path.slice(0, -1)) as Document | CstNode;
	parent.children!.splice(path[path.length - 1], 1);
	return doc;
}

function target(doc: Document, path: number[], offset: number, openCollapsed = false) {
	return caretTargetFor(doc, { path: docPathFrom(path), offset }, { openCollapsed });
}

beforeEach(registerChromePluginsForTests);

describe('caretTargetFor', () => {
	it('a leaf keeps its offset, sentinels included; the block resolves them on focus', () => {
		const doc = parse('abc\n');
		expect(target(doc, [0], 2)).toEqual({ leafPath: [0], offset: 2 });
		expect(target(doc, [0], CURSOR_END)).toEqual({ leafPath: [0], offset: CURSOR_END });
	});

	it('a dead path resolves to nothing', () => {
		expect(target({ kind: 'document', prefix: '', children: [], suffix: '' }, [], 0)).toBeNull();
		expect(target(parse('abc\n'), [3], 0)).toBeNull();
		expect(target(parse('abc\n'), [0, 0], 0)).toBeNull();
	});

	// [0] the list, [0,1] the second item, whose last child is a two-by-two table.
	const LIST_TABLE = '- a\n- b\n\n  | h1 | h2 |\n  | -- | -- |\n  | c1 | c2 |\n';

	const edges: Array<[string, number, number[], number]> = [
		['0', 0, [0, 0, 0], 0],
		['CURSOR_START', CURSOR_START, [0, 0, 0], CURSOR_START],
		['CURSOR_EXACT_START', CURSOR_EXACT_START, [0, 0, 0], CURSOR_EXACT_START],
		['CURSOR_END', CURSOR_END, [0, 1, 1, 1, 1], CURSOR_END],
		['FOCUS_LAST_START', FOCUS_LAST_START, [0, 1, 1, 1, 1], FOCUS_LAST_START]
	];
	for (const [name, offset, leafPath, leafOffset] of edges) {
		it(`a container entered with ${name} lands in its ${leafPath.length > 3 ? 'last' : 'first'} leaf`, () => {
			expect(target(parse(LIST_TABLE), [0], offset)).toEqual({ leafPath, offset: leafOffset });
		});
	}

	it('a byte offset into a strip container lands on the leaf holding that byte', () => {
		// One paragraph over two quoted lines; byte 5 is the second line's marker, which maps to
		// the start of that line in the paragraph.
		expect(target(parse('> a\n> b\n'), [0], 5)).toEqual({ leafPath: [0, 0], offset: 2 });
	});

	it('a byte offset into a table, which cannot map bytes, lands at its last cell end', () => {
		const doc = parse('| a | b |\n| - | - |\n| c | d |\n');
		expect(target(doc, [0], 5)).toEqual({ leafPath: [0, 1, 1], offset: CURSOR_END });
	});

	it('a path into a closed body lands at the end of the title row', () => {
		const doc = parse('Above\n\n' + CLOSED);
		expect(target(doc, [1, 1], 3)).toEqual({ leafPath: [1, 0], offset: CURSOR_END });
		expect(target(doc, [1], CURSOR_END)).toEqual({ leafPath: [1, 0], offset: CURSOR_END });
	});

	it('a navigation that opens the container goes into the body as asked', () => {
		const doc = parse('Above\n\n' + CLOSED);
		expect(target(doc, [1, 1], 3, true)).toEqual({ leafPath: [1, 1], offset: 3 });
	});

	it('the outermost closed container wins when two are nested', () => {
		const doc = parse(
			'<details>\n<summary>Outer</summary>\n\nBody\n\n' + CLOSED + '\n</details>\n'
		);
		expect(target(doc, [0, 2, 1], 0)).toEqual({ leafPath: [0, 0], offset: CURSOR_END });
	});
});

describe('survivorAfterRemoval', () => {
	// Each case removes one block from the source, then asks on the tree left behind.
	const cases: Array<[string, string, number[], 'before' | 'after', object | null]> = [
		[
			'a middle block, Backspace',
			'a\n\nb\n\nc\n',
			[1],
			'before',
			{ path: [0], offset: CURSOR_END }
		],
		['a middle block, Delete', 'a\n\nb\n\nc\n', [1], 'after', { path: [1], offset: CURSOR_START }],
		['the first block, Backspace', 'a\n\nb\n', [0], 'before', { path: [0], offset: CURSOR_START }],
		['the last block, Delete', 'a\n\nb\n', [1], 'after', { path: [0], offset: CURSOR_END }],
		['the only block', 'a\n', [0], 'before', null],
		[
			'the block after a closed details',
			'Above\n\n' + CLOSED + '\nGone\n',
			[2],
			'before',
			{ path: [1, 0], offset: CURSOR_END }
		],
		[
			'the first item of a list, Backspace',
			'top\n\n- a\n- b\n',
			[1, 0],
			'before',
			{ path: [0], offset: CURSOR_END }
		],
		[
			'the block before a table, Delete',
			'gone\n\n| a | b |\n| - | - |\n| c | d |\n',
			[0],
			'after',
			{ path: [0, 0, 0], offset: CURSOR_START }
		]
	];
	for (const [name, source, removed, side, expected] of cases) {
		it(name, () => {
			const doc = removeChildAt(parse(source), removed);
			expect(survivorAfterRemoval(doc, removed, side)).toEqual(expected);
		});
	}

	it('reads the slot of the nearest surviving ancestor when the parent went too', () => {
		// The quote holding [1, 0] is gone as well, so the position is [1], past the end.
		const doc = removeChildAt(parse('a\n\n> q\n'), [1]);
		for (const side of ['before', 'after'] as const) {
			expect(survivorAfterRemoval(doc, [1, 0], side)).toEqual({ path: [0], offset: CURSOR_END });
		}
	});

	// The two cases below are the property suite's shrunk counterexamples, each read on the tree
	// the removal left.
	it('a removal inside a closed body lands on the title row or past the block, never inside', () => {
		const doc = parse('Above\n\n<details>\n<summary>Sum</summary>\n\nH2\n\n</details>\n\nBelow\n');
		expect(survivorAfterRemoval(doc, [1, 1], 'after')).toEqual({
			path: [2],
			offset: CURSOR_START
		});
		expect(survivorAfterRemoval(doc, [1, 1], 'before')).toEqual({
			path: [1, 0],
			offset: CURSOR_END
		});
	});

	it('a list emptied and removed with its only item reads the slot the list left', () => {
		// The paragraph that followed the list now sits at [0], so [0] is no parent of [0, 0].
		expect(survivorAfterRemoval(parse('para\n'), [0, 0], 'before')).toEqual({
			path: [0],
			offset: CURSOR_START
		});
	});
});
