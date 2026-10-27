import { describe, it, expect } from 'vitest';
import { parse } from '../../../../core/parser';
import { blockNodeAt, nodeAt } from '../../../../tree-operations/node-primitives';
import type { Document } from '../../../../core/nodes';
import { cellPoint, type SelectionPoint } from '../../../../selection/primitives';
import { deleteRange } from '../../../harness/range-delete';

// Two 2×2 tables followed by a blockquote, and the same pair nested inside a blockquote holding a
// paragraph. Selecting across both tables empties them, forcing the survivor caret path.
const FLAT =
	'| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| C | D |\n| --- | --- |\n| 3 | 4 |\n\n> quoted text\n';
const NESTED =
	'para A\n\n> para B\n>\n> | A | B |\n> | --- | --- |\n> | 1 | 2 |\n>\n> | C | D |\n> | --- | --- |\n> | 3 | 4 |\n';

function run(source: string, start: SelectionPoint, end: SelectionPoint) {
	const doc = parse(source);
	const result = deleteRange(doc, start, end);
	return { doc: result.newDoc, caret: result.caret(result.newDoc)! };
}

function isLeafAt(doc: Document, path: number[]): boolean {
	const node = nodeAt(doc, path);
	if (!node) return false;
	return !('children' in node) || !node.children || node.children.length === 0;
}

describe('rangeDelete: survivor caret when both endpoint tables are consumed', () => {
	it('descends into a surviving container instead of naming its bare path', () => {
		const { doc, caret } = run(FLAT, cellPoint([0], 0), cellPoint([1], 3));

		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('blockquote');
		expect(caret).toEqual({ path: [0, 0], offset: 0 });
		expect(isLeafAt(doc, caret.path)).toBe(true);
	});

	it('finds the survivor in the deleted block’s own container, not at document level', () => {
		const { doc, caret } = run(NESTED, cellPoint([1, 1], 0), cellPoint([1, 2], 3));

		// The blockquote keeps "para B"; the caret belongs at its end, not at the
		// end of the unrelated top-level "para A" that shares index 0.
		expect(blockNodeAt(doc, caret.path)?.raw.trimEnd()).toBe('para B');
		expect(caret).toEqual({ path: [1, 0], offset: 6 });
	});
});
