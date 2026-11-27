import { deleteNode } from '#lib/tree-operations/node-ops.js';
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import {
	numberingOf,
	numberingOfList,
	renumberOrderedList
} from '#lib/tree-operations/list/ordered-markers.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { setPluginMetadata, type CstNode } from '#lib/core/nodes.js';
import { bodyUnder } from '#lib/tree-operations/node-primitives.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';

// Miss-analysis: every numbering read was of a list starting at 1 or more and counting up by one, so
// a clamp of 0 to 1 and a step that is always 1 both read the bytes the author wrote.
describe('a list’s numbering is read off its first two numbers', () => {
	it.each([
		{ first: 1, second: 1, numbering: { start: 1, step: 0 } },
		{ first: 1, second: 2, numbering: { start: 1, step: 1 } },
		{ first: 0, second: 0, numbering: { start: 0, step: 0 } },
		{ first: 0, second: 1, numbering: { start: 0, step: 1 } },
		{ first: 3, second: 5, numbering: { start: 3, step: 1 } },
		{ first: 7, second: null, numbering: { start: 7, step: 1 } },
		{ first: null, second: null, numbering: { start: 1, step: 1 } }
	])('$first then $second', ({ first, second, numbering }) => {
		expect(numberingOf(first, second)).toEqual(numbering);
	});

	it('reads a list’s first two items, a bullet marker counting as no number', () => {
		const first = (source: string) => parse(source).children[0];
		expect(numberingOfList(first('0. a\n0. b\n1. c\n'))).toEqual({ start: 0, step: 0 });
		expect(numberingOfList(first('- a\n- b\n'))).toEqual({ start: 1, step: 1 });
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
		renumberOrderedList(
			list,
			0,
			{ start: base, step: 1 },
			createSharingState(),
			defaultGrammarView
		);
		expect(list.children![0].raw).toBe(after);
	});
});

// Miss-analysis: every caller passed an index past 0 or a list starting at 1, so a renumber that
// reset item 0 to 1 went unasked.
it('a renumber from index 0 keeps the first item’s number as the list’s start', () => {
	const list = parse('8. a\n3. b\n').children[0];
	renumberOrderedList(list, 0, numberingOfList(list), createSharingState(), defaultGrammarView);
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
			edit: (q: CstNode) => deleteNode(bodyUnder(q, '\n'), 0, sharing(), defaultGrammarView)
		},
		{
			route: 'renumberOrderedList',
			removed: 0,
			edit: (q: CstNode) =>
				renumberOrderedList(q, 0, numberingOf(1, 2), sharing(), defaultGrammarView)
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
