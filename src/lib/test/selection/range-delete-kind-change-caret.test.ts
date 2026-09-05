import { describe, it, expect } from 'vitest';
import { rangeDelete } from '../../selection/range-delete';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { nodeAt } from '../../tree-operations/node-ops';
import { createSharingState } from '../../tree-operations/sharing';
import type { Document } from '../../core/nodes';

function run(
	source: string,
	start: { path: number[]; offset: number },
	end: { path: number[]; offset: number }
) {
	const doc = parse(source);
	const result = rangeDelete(
		doc,
		start,
		end,
		createSharingState(),
		undefined,
		undefined,
		undefined
	);
	return { doc: result.newDoc, source: serialize(result.newDoc), caret: result.collapsedCaret };
}

function isLeafAt(doc: Document, path: number[]): boolean {
	const node = nodeAt(doc, path);
	if (!node) return false;
	return !('children' in node) || !node.children || node.children.length === 0;
}

// A cross-block merge re-parses the joined raw and may change kind, leaf into CONTAINER. The
// caret is restored by walking the block element at its path, so it must name a leaf whatever the
// merge produced — a container path walks the subtree and focuses a non-editable wrapper.
describe('rangeDelete caret after a merge that re-parses into a container', () => {
	// Caret at the start of the paragraph's second line, Shift+ArrowDown, Backspace:
	// the surviving head keeps its line ending, so the join re-parses as a table.
	it('descends into a table produced by joining a header row to its delimiter', () => {
		const { doc, source, caret } = run(
			'| a | b |\nxx\n\n|---|---|\n| 1 | 2 |\n',
			{ path: [0], offset: 10 },
			{ path: [1], offset: 0 }
		);

		expect(source).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
		expect(doc.children[0].kind).toBe('table');
		expect(isLeafAt(doc, caret.path)).toBe(true);
	});

	it('descends into a list produced by joining a marker to its item text', () => {
		const { doc, source, caret } = run(
			'1\n\n. item\n',
			{ path: [0], offset: 1 },
			{ path: [1], offset: 0 }
		);

		expect(source).toBe('1. item\n');
		expect(doc.children[0].kind).toBe('list');
		expect(isLeafAt(doc, caret.path)).toBe(true);
	});

	it('descends into a blockquote produced by joining a marker to its body', () => {
		const { doc, source, caret } = run(
			'>\n\n quote\n',
			{ path: [0], offset: 1 },
			{ path: [1], offset: 0 }
		);

		expect(source).toBe('> quote\n');
		expect(doc.children[0].kind).toBe('blockquote');
		expect(isLeafAt(doc, caret.path)).toBe(true);
	});

	it('leaves a leaf-to-leaf merge caret at the join offset', () => {
		const { doc, caret } = run(
			'hello world\n\nfoo bar\n',
			{ path: [0], offset: 6 },
			{ path: [1], offset: 4 }
		);

		expect(caret).toEqual({ path: [0], offset: 6 });
		expect(isLeafAt(doc, caret.path)).toBe(true);
	});
});
