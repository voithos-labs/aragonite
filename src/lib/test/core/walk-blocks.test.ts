import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { ancestorsOf, walkBlocks } from '$lib/core/paths';
import type { NodeView } from '$lib/core/node-views';

// A quote holding a list, then a top-level paragraph: three levels deep, siblings at each.
const SOURCE = '> - a\n> - b\n>\n> c\n\nd\n';

function visited(root = parse(SOURCE)) {
	const seen: string[] = [];
	walkBlocks(root, (node, path) => void seen.push(`${path.join('.')} ${node.kind}`));
	return seen;
}

describe('walkBlocks', () => {
	it('visits every block pre-order in document order, the root left out', () => {
		expect(visited()).toEqual([
			'0 blockquote',
			'0.0 list',
			'0.0.0 listItem',
			'0.0.0.0 paragraph',
			'0.0.1 listItem',
			'0.0.1.0 paragraph',
			'0.1 paragraph',
			'1 paragraph'
		]);
	});

	it("'skip' leaves out that node's children and carries on with its siblings", () => {
		const seen: string[] = [];
		walkBlocks(parse(SOURCE), (node, path) => {
			seen.push(path.join('.'));
			if (node.kind === 'list') return 'skip';
		});
		expect(seen).toEqual(['0', '0.0', '0.1', '1']);
	});

	it("'stop' ends the walk at once and returns true; a full walk returns false", () => {
		const seen: string[] = [];
		const stopped = walkBlocks(parse(SOURCE), (node, path) => {
			seen.push(path.join('.'));
			if (node.kind === 'listItem') return 'stop';
		});
		expect(stopped).toBe(true);
		expect(seen).toEqual(['0', '0.0', '0.0.0']);
		expect(walkBlocks(parse(SOURCE), () => {})).toBe(false);
	});

	it('prefixes every path with basePath when walking a subtree', () => {
		const quote = parse(SOURCE).children[0];
		const paths: number[][] = [];
		walkBlocks(quote, (_node, path) => void paths.push(path), [7]);
		expect(paths[0]).toEqual([7, 0]);
		expect(paths.at(-1)).toEqual([7, 1]);
	});

	it('never writes to a path array after handing it over, even when the visitor does', () => {
		const kept: number[][] = [];
		walkBlocks(parse(SOURCE), (_node, path) => {
			kept.push(path);
			path.push(99);
		});
		expect(kept.map((path) => path.slice(0, -1).join('.'))).toEqual(
			visited().map((line) => line.split(' ')[0])
		);
	});
});

describe('ancestorsOf', () => {
	it('lists the blocks strictly between the root and the path, outermost first', () => {
		const kinds = (nodes: NodeView[]) => nodes.map((node) => node.kind);
		expect(kinds(ancestorsOf(parse(SOURCE), [0, 0, 1, 0]))).toEqual([
			'blockquote',
			'list',
			'listItem'
		]);
		expect(ancestorsOf(parse(SOURCE), [1])).toEqual([]);
	});
});
