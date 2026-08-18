// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { orderedBaseOf, readOrderedSuffix } from '$lib/tree-operations/list/ordered-markers';
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
