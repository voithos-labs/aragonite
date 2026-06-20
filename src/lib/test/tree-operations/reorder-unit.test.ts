import { describe, it, expect } from 'vitest';
import { parse } from '$lib/editor/core/parser';
import { resolveReorderUnit } from '$lib/editor/tree-operations/reorder-unit';

describe('resolveReorderUnit', () => {
	it('top-level block resolves to itself under the document', () => {
		const doc = parse('a\n\nb\n\nc\n');
		expect(resolveReorderUnit(doc, [1])).toEqual({
			parentPath: [],
			index: 1,
			parentKind: 'document'
		});
	});

	it('a paragraph inside a list item resolves to the item under the list', () => {
		const doc = parse('- one\n- two\n- three\n');
		expect(resolveReorderUnit(doc, [0, 1, 0])).toEqual({
			parentPath: [0],
			index: 1,
			parentKind: 'list'
		});
	});

	it('a blockquote child resolves to itself under the blockquote', () => {
		const doc = parse('> a\n>\n> b\n');
		expect(resolveReorderUnit(doc, [0, 1])).toEqual({
			parentPath: [0],
			index: 1,
			parentKind: 'blockquote'
		});
	});

	it('walks past the nearest non-reorderable parent to the list', () => {
		// listItem is not reorderable on its own — the unit is the item under the list.
		const doc = parse('- one\n- two\n- three\n');
		expect(resolveReorderUnit(doc, [0, 2])).toEqual({
			parentPath: [0],
			index: 2,
			parentKind: 'list'
		});
	});

	it('resolves a table cell up to the table as a top-level document block', () => {
		// table/tableRow/tableCell are not reorderable, but the table itself is a
		// top-level block — the resolver climbs to the document slot it occupies.
		const doc = parse('| a | b |\n| - | - |\n| c | d |\n');
		expect(resolveReorderUnit(doc, [0, 0, 0])).toEqual({
			parentPath: [],
			index: 0,
			parentKind: 'document'
		});
	});

	it('returns null for the empty path — no slot to move', () => {
		const doc = parse('a\n\nb\n');
		expect(resolveReorderUnit(doc, [])).toBeNull();
	});
});
