import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import {
	orderedBaseOf,
	readOrderedSuffix,
	renumberOrderedListFrom
} from '$lib/tree-operations/list/ordered-markers';
import { createSharingState } from '$lib/tree-operations/sharing';
import type { CstNode } from '$lib/core/nodes';

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
