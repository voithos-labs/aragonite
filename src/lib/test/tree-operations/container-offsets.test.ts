import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { displayLength } from '$lib/core/lines';
import type { CstNode } from '$lib/core/nodes';
import { leafAtRawOffset, rawOffsetOfLeaf } from '$lib/tree-operations/container-offsets';

// A fix-up that merges blocks tracks the caret as an offset into the merged block's raw, and a
// container's raw re-prefixes its children's lines, so the offset has to be mapped to a leaf.
// Miss-analysis: no primitive existed, so every landing into a container fell back to its end
// and the suites pinned that fallback as the behaviour (GH #193).

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
