import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { displayLength } from '#lib/core/lines.js';
import fc from 'fast-check';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { arbLawDocument } from '../range-laws/shapes';
import { testReading } from '../range-edit/test-host';
import {
	documentByteMap,
	leafAtRawOffset,
	rawOffsetOfLeaf
} from '#lib/tree-operations/container-offsets.js';
import { docAround, gridOf, registerPluginGrid } from '../selection/cross-block/plugin-grid-kind';

// A fix-up that merges blocks tracks the caret as an offset into the merged block's raw, and a
// container's raw re-prefixes its children's lines, so the offset has to be mapped to a leaf.
// Miss-analysis: GH #193, every caret put into a container fell to its end, and tests pinned it.

const top = (source: string): CstNode => parse(source).children[0];

describe('a raw offset into a container', () => {
	it('lands in the leaf holding it, prefix stripped', () => {
		expect(leafAtRawOffset(top('> q\nAfter\n'), 3)).toEqual({ path: [0], offset: 1 });
		expect(leafAtRawOffset(top('- item\n  more\n'), 6)).toEqual({ path: [0, 0], offset: 4 });
	});

	it('reads a lazy line, which carries no prefix, column for column', () => {
		expect(leafAtRawOffset(top('> q\nAfter\n'), 'q\nAft'.length + 2)).toEqual({
			path: [0],
			offset: 'q\nAft'.length
		});
	});

	it('clamps an offset on a prefix to the start of that line’s text', () => {
		expect(leafAtRawOffset(top('> a\n> b\n'), 5)).toEqual({ path: [0], offset: 2 });
	});

	// Miss-analysis: every fixture indented with spaces, so a tab that cuts through a marker's
	// columns read the line's text from its start.
	it('reads a nested item indented with a tab from where its text starts', () => {
		const list = top('- a\n\t- b\n');
		expect(leafAtRawOffset(list, 8)).toEqual({ path: [0, 1, 0, 0], offset: 1 });
		expect(rawOffsetOfLeaf(list, [0, 1, 0, 0], 1)).toBe(8);
	});

	it('is refused for a container whose bytes it cannot map', () => {
		expect(leafAtRawOffset(top('| a |\n| - |\n| b |\n'), 3)).toBeNull();
		expect(rawOffsetOfLeaf(top('| a |\n| - |\n| b |\n'), [0, 0], 0)).toBeNull();
	});
});

describe('the leaf position back to a raw offset', () => {
	const nested = top('> - a\n>   b\n>\n> c\n');

	/** Every caret position in every leaf of `node`, as a path and an offset. */
	function positions(node: CstNode, path: number[] = []): { path: number[]; offset: number }[] {
		if (!node.children?.length) {
			return Array.from({ length: displayLength(node.raw) + 1 }, (_, offset) => ({ path, offset }));
		}
		return node.children.flatMap((child, i) => positions(child, [...path, i]));
	}

	it('comes back to the same leaf position through nested containers', () => {
		for (const at of positions(nested)) {
			const raw = rawOffsetOfLeaf(nested, at.path, at.offset);
			expect(raw, JSON.stringify(at)).not.toBeNull();
			expect(leafAtRawOffset(nested, raw!), JSON.stringify(at)).toEqual(at);
		}
	});
});

// The byte map reads a list's offsets as its items' own, without splitting its lines, which holds
// only while a list's bytes are its items' and nothing else: tabs, lazy lines and loose items too.
describe('a list holds its items’ bytes and nothing else', () => {
	const lists = (node: CstNode | Document): CstNode[] =>
		(node.children ?? []).flatMap((child) => [
			...(child.kind === 'list' ? [child] : []),
			...lists(child)
		]);
	it('over the law draw', () => {
		const grammar = testReading().grammar;
		for (const source of fc.sample(arbLawDocument, { numRuns: 300, seed: 20261105 })) {
			for (const list of lists(readAsOpened(source, { grammar, scope: 'document' }))) {
				const items = list.children!.map((c) => c.leadingTrivia + c.raw).join('');
				expect(items, JSON.stringify(source)).toBe(list.raw);
			}
		}
	});
});

// Miss-analysis: every grid here was a table, whose rows carry their own line endings; a plugin
// grid's rebuild may write the break between rows instead, and every cell read as one byte.
describe('a grid whose rows leave their line breaks to the grid', () => {
	it('maps each cell to its own bytes', () => {
		const doc = docAround(
			gridOf(registerPluginGrid(), [
				['ab', 'cd'],
				['ef', 'gh']
			])
		);
		const map = documentByteMap(doc);
		const starts = [
			[1, 0, 0],
			[1, 0, 1],
			[1, 1, 0],
			[1, 1, 1]
		].map((path) => map.byteOf(path, 0));
		expect(starts).toEqual([5, 8, 11, 14]);
	});
});
