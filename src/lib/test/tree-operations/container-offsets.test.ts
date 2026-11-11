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
import { measured } from '#lib/tree-operations/top-level-starts.js';

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

// Miss-analysis: every titled fixture had title text, and an empty one paired with the blank line
// below its tags, so the body under it read one line low (found by the caret-walk property).
describe('a title row with no text', () => {
	it('sits inside its tags, and the body below keeps its own lines', () => {
		testReading();
		const source = '<details open>\n<summary></summary>\n\nx\n\n</details>\n\nafter\n';
		const map = documentByteMap(measured(parse(source)));
		expect(map.byteOf([0, 0], 0)).toBe(source.indexOf('</summary>'));
		expect(map.byteOf([0, 1], 0)).toBe(source.indexOf('x'));
		expect(map.leafAt(source.indexOf('x'))).toEqual({ path: [0, 1], offset: 0 });
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
		const map = documentByteMap(measured(doc));
		const starts = [
			[1, 0, 0],
			[1, 0, 1],
			[1, 1, 0],
			[1, 1, 1]
		].map((path) => map.byteOf(path, 0));
		expect(starts).toEqual([5, 8, 11, 14]);
	});
});

// Miss-analysis: the cost rows counted blocks laid out, never the items a list's map read, so a
// copy of four items of a 10 MB list read every item's length through the editor's proxies.
describe('a list’s map reads only the items a lookup asks about', () => {
	const ITEMS = 4000;
	const counted = () => {
		const doc = parse(Array.from({ length: ITEMS }, (_, i) => `- item ${i}\n`).join(''));
		const list = doc.children[0] as CstNode;
		const reads = { count: 0 };
		// Each index read stands in for the trap a `$state` proxy pays.
		list.children = new Proxy(list.children!, {
			get: (items, key, receiver) => {
				if (typeof key === 'string' && /^\d+$/.test(key)) reads.count++;
				return Reflect.get(items, key, receiver);
			}
		});
		return { doc, reads };
	};

	it('maps a byte near either end, and a byte back to its item, reading a handful of items', () => {
		for (const item of [3, ITEMS - 3]) {
			const { doc, reads } = counted();
			const map = documentByteMap(measured(doc));
			const byte = map.byteOf([0, item, 0], 2)!;
			expect(map.leafAt(byte)).toEqual({ path: [0, item, 0], offset: 2 });
			expect(reads.count, `item ${item}`).toBeLessThan(4 * Math.log2(ITEMS));
		}
	});

	it('sums the items when the list’s spans no longer hold them', () => {
		const { doc } = counted();
		const list = doc.children[0] as CstNode;
		list.childSpans = list.childSpans!.map((at) => (at === 0 ? 0 : at + 1));
		list.childSpans[list.childSpans.length - 1] = list.raw.length;
		expect(documentByteMap(measured(doc)).byteOf([0, 5, 0], 0)).toBe(5 * 9 + 2);
	});
});
