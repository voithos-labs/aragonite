import { deleteNode } from '#lib/tree-operations/node-ops.js';
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import {
	orderedBaseOf,
	readOrderedSuffix,
	renumberOrderedList,
	renumberOrderedListFrom
} from '#lib/tree-operations/list/ordered-markers.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { setPluginMetadata, type CstNode } from '#lib/core/nodes.js';
import { bodyUnder } from '#lib/tree-operations/node-primitives.js';

describe('ordered-markers reads', () => {
	it('orderedBaseOf reads numeric prefix; defaults to 1', () => {
		expect(
			orderedBaseOf({
				kind: 'listItem',
				leadingTrivia: '',
				raw: '',
				metadata: { marker: '5. ' }
			} as CstNode)
		).toBe(5);
		expect(
			orderedBaseOf({
				kind: 'listItem',
				leadingTrivia: '',
				raw: '',
				metadata: { marker: '- ' }
			} as CstNode)
		).toBe(1);
		expect(orderedBaseOf(undefined)).toBe(1);
	});

	it('readOrderedSuffix reads suffix from list first item', () => {
		const list = parse('1. a\n').children[0];
		expect(readOrderedSuffix(list)).toBe('. ');
	});
});

// Miss-analysis: every renumber fixture indented its continuations with spaces to the marker's
// width, so a renumber that respelled every line wrote the bytes it read.
describe('a renumber rewrites the number and only the lines the new width leaves short', () => {
	it.each([
		['a continuation the wider number leaves short', '9. a\n   b\n', 10, '10. a\n    b\n'],
		['a tab continuation that still reads', '1. a\n\tb\n', 2, '2. a\n\tb\n']
	])('%s', (_name, source, base, after) => {
		const list = parse(source).children[0];
		renumberOrderedListFrom(list, base, createSharingState());
		expect(list.children![0].raw).toBe(after);
	});
});

// Miss-analysis: every caller passed an index past 0 or a list starting at 1, so a renumber that
// reset item 0 to 1 went unasked.
it('a renumber from index 0 keeps the first item’s number as the list’s start', () => {
	const list = parse('8. a\n3. b\n').children[0];
	renumberOrderedList(list, 0, createSharingState());
	expect(list.children!.map((item) => item.raw)).toEqual(['8. a\n', '9. b\n']);
});

// Miss-analysis: every renumber fixture's owner was a list or the document, never a container
// whose own metadata happens to carry an `ordered` field.
describe('a renumber touches only an ordered list', () => {
	const sharing = createSharingState;
	it.each([
		{
			route: 'deleteNode',
			removed: 1,
			edit: (q: CstNode) => deleteNode(bodyUnder(q, '\n'), 0, sharing())
		},
		{
			route: 'renumberOrderedList',
			removed: 0,
			edit: (q: CstNode) => renumberOrderedList(q, 1, sharing())
		},
		{
			route: 'renumberOrderedListFrom',
			removed: 0,
			edit: (q: CstNode) => renumberOrderedListFrom(q, 1, sharing())
		}
	])(
		'$route leaves a plugin container whose metadata says ordered as it was',
		({ removed, edit }) => {
			const quote = parse('> a\n>\n> b\n>\n> c\n').children[0];
			setPluginMetadata(quote, { ordered: true });
			const before = quote.children!.map((child) => child.raw);
			edit(quote);
			expect(quote.children!.map((child) => child.raw)).toEqual(before.slice(removed));
		}
	);
});
