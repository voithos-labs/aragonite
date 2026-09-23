import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode } from '$lib/core/nodes';
import type { GrammarView } from '$lib/schema/block-openers';
import { createRegistryView } from '$lib/schema/registry-view';

// The `syntax` prop takes indented code and setext headings out of one editor's grammar. The
// bytes never change; only how they read does, and a nested body reads them the same way.

const off = createRegistryView({ syntax: { indentedCode: false, setextHeading: false } }).grammar;

function kinds(source: string, grammar?: GrammarView): string[] {
	const doc = parse(source, { grammar });
	expect(serialize(doc)).toBe(source);
	const walk = (nodes: CstNode[]): string[] =>
		nodes.flatMap((n) => [n.kind, ...(n.children ? walk(n.children) : [])]);
	return walk(doc.children);
}

describe('syntax switches: indented code', () => {
	it.each([
		['\tnotes\n', ['indentedCode'], ['paragraph']],
		['    notes\r\n', ['indentedCode'], ['paragraph']],
		['> \tnotes\n', ['blockquote', 'indentedCode'], ['blockquote', 'paragraph']],
		[
			'- a\n\n      notes\n',
			['list', 'listItem', 'paragraph', 'indentedCode'],
			['list', 'listItem', 'paragraph', 'paragraph']
		]
	])('%j reads as indented code with it on, prose with it off', (source, on, offKinds) => {
		expect(kinds(source)).toEqual(on);
		expect(kinds(source, off)).toEqual(offKinds);
	});
});

describe('syntax switches: setext headings', () => {
	it.each([
		['Plan\n---\n', ['setextHeading'], ['paragraph', 'thematicBreak']],
		['Plan\n===\n', ['setextHeading'], ['paragraph']],
		['Plan\n--\n', ['setextHeading'], ['paragraph']],
		[
			'> Plan\n> ---\n',
			['blockquote', 'setextHeading'],
			['blockquote', 'paragraph', 'thematicBreak']
		],
		[
			'- Plan\n  ---\n',
			['list', 'listItem', 'setextHeading'],
			['list', 'listItem', 'paragraph', 'thematicBreak']
		]
	])('%j reads as a setext heading with it on, not with it off', (source, on, offKinds) => {
		expect(kinds(source)).toEqual(on);
		expect(kinds(source, off)).toEqual(offKinds);
	});

	it('a `===` line stays in the paragraph it follows', () => {
		const doc = parse('Plan\n===\nmore\n', { grammar: off });
		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([['paragraph', 'Plan\n===\nmore\n']]);
	});
});

describe('syntax switches: each switch alone', () => {
	it('switching setext off leaves indented code on', () => {
		const grammar = createRegistryView({ syntax: { setextHeading: false } }).grammar;
		expect(kinds('\tnotes\n', grammar)).toEqual(['indentedCode']);
		expect(kinds('Plan\n---\n', grammar)).toEqual(['paragraph', 'thematicBreak']);
	});

	it('switching indented code off leaves setext on', () => {
		const grammar = createRegistryView({ syntax: { indentedCode: false } }).grammar;
		expect(kinds('\tnotes\n', grammar)).toEqual(['paragraph']);
		expect(kinds('Plan\n---\n', grammar)).toEqual(['setextHeading']);
	});
});
