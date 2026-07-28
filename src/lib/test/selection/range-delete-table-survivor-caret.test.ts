import { describe, it, expect } from 'vitest';
import { rangeDelete } from '../../selection/range-delete';
import { parse } from '../../core/parser';
import { blockNodeAt, nodeAt } from '../../tree-operations/node-ops';
import { createSharingState } from '../../tree-operations/sharing';
import type { Document } from '../../core/nodes';

// Two 2×2 tables followed by a blockquote; and the same pair nested inside a
// blockquote that also holds a paragraph. Selecting the first table's cell 0 to
// the second table's last cell empties both, so the caret falls to the
// "everything the caret could land in was deleted" survivor path.
const FLAT =
	'| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| C | D |\n| --- | --- |\n| 3 | 4 |\n\n> quoted text\n';
const NESTED =
	'para A\n\n> para B\n>\n> | A | B |\n> | --- | --- |\n> | 1 | 2 |\n>\n> | C | D |\n> | --- | --- |\n> | 3 | 4 |\n';

function isLeafAt(doc: Document, path: number[]): boolean {
	const node = nodeAt(doc, path);
	if (!node) return false;
	return !('children' in node) || !node.children || node.children.length === 0;
}

describe('rangeDelete — survivor caret when both endpoint tables are consumed', () => {
	it('descends into a surviving container instead of naming its bare path', () => {
		const result = rangeDelete(
			parse(FLAT),
			{ path: [0], offset: 0 },
			{ path: [1], offset: 3 },
			createSharingState(),
			undefined
		);

		expect(result.newDoc.children).toHaveLength(1);
		expect(result.newDoc.children[0].kind).toBe('blockquote');
		expect(result.collapsedCaret).toEqual({ path: [0, 0], offset: 0 });
		expect(isLeafAt(result.newDoc, result.collapsedCaret.path)).toBe(true);
	});

	it('finds the survivor in the deleted block’s own container, not at document level', () => {
		const result = rangeDelete(
			parse(NESTED),
			{ path: [1, 1], offset: 0 },
			{ path: [1, 2], offset: 3 },
			createSharingState(),
			undefined
		);

		// The blockquote keeps "para B"; the caret belongs at its end, not at the
		// end of the unrelated top-level "para A" that shares index 0.
		const caret = result.collapsedCaret;
		expect(blockNodeAt(result.newDoc, caret.path)?.raw.trimEnd()).toBe('para B');
		expect(caret).toEqual({ path: [1, 0], offset: 6 });
	});
});
