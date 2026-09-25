import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRegistryView } from '$lib/schema/registry-view';
import { registerMathBlock } from '$lib/plugins/latex/latex-kind';
import { resetPluginPlatformForTests } from '$lib/testing';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { deleteNode, spliceChildrenSettled } from '$lib/tree-operations/settle';
import { updateNodeContent } from '$lib/tree-operations/content-write';
import { unwrapFirstChildFromQuote } from '$lib/tree-operations/blockquote';
import { describeConvergence, layoutOf } from '$lib/test/harness/parse-converged';
import { settled } from '$lib/test/harness/settle-funnel';
import type { CstNode, Document } from '$lib/core/nodes';
import { defaultGrammarView } from '$lib/schema/block-openers';

// A table takes any line straight below its rows that opens no other block, so a block an edit
// turns into text right under a table gets a blank line between, and stays the block it is.
// Miss-analysis: every table pin put a blank line or a block marker under the table, so no test
// turned the block right under one into text.

const T = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

function unwrapQuote(parent: CstNode | Document, at: number): void {
	spliceChildrenSettled(
		parent,
		at,
		1,
		unwrapFirstChildFromQuote(parent.children![at]),
		defaultGrammarView
	);
}

describe('a block turned into text right under a table keeps a blank line', () => {
	it.each([
		['a quote unwrapped', `${T}> q\n`, `${T}\nq\n`],
		['a quote holding a pipe unwrapped', `${T}> q | r\n`, `${T}\nq | r\n`]
	])('%s', (_, source, expected) => {
		const doc = parse(source);

		unwrapQuote(doc, 1);

		expect(serialize(doc)).toBe(expected);
		expect(doc.children.map((c) => c.kind)).toEqual(['table', 'paragraph']);
		expect(describeConvergence(doc)).toBeNull();
	});

	it('a heading turned into text', () => {
		const doc = parse(`${T}# Head\n`);

		settled(doc, () => updateNodeContent(doc, 1, 'Head\n', defaultGrammarView).change);

		expect(serialize(doc)).toBe(`${T}\nHead\n`);
		expect(describeConvergence(doc)).toBeNull();
	});

	it.each([
		['LF', T, '\n'],
		['CRLF', T.replaceAll('\n', '\r\n'), '\r\n']
	])('a delete of the block between (%s)', (_, table, eol) => {
		const doc = parse(`${table}---${eol}next${eol}`);

		settled(doc, (body) => deleteNode(body, 1, defaultGrammarView));

		expect(serialize(doc)).toBe(`${table}${eol}next${eol}`);
		expect(describeConvergence(doc)).toBeNull();
	});

	it('inside a quote', () => {
		const doc = parse(`> ${T.trimEnd().replaceAll('\n', '\n> ')}\n> > q\n`);
		const quote = doc.children[0];

		unwrapQuote(quote, 1);

		expect(layoutOf(quote.children!).map(([kind, trivia]) => [kind, trivia])).toEqual([
			['table', ''],
			['paragraph', '\n']
		]);
	});

	it('a block that ends the table on its own takes no blank line', () => {
		const doc = parse(`${T}---\n# h\n`);

		settled(doc, (body) => deleteNode(body, 1, defaultGrammarView));

		expect(serialize(doc)).toBe(`${T}# h\n`);
		expect(describeConvergence(doc)).toBeNull();
	});
});

// The follower is read in the editor's grammar and over its own lines, the reading the parse gives
// the same bytes on reload. Miss-analysis: the check read one line under the default grammar, and
// every pin above used a one-line built-in opener.
describe('the blank line a follower takes depends on the editor’s grammar', () => {
	beforeAll(() => {
		resetPluginPlatformForTests();
		registerMathBlock();
	});
	afterAll(() => resetPluginPlatformForTests());

	it('a `$$` block that closes below ends the table, so it takes none', () => {
		const doc = parse(`${T}---\n$$\nx\n$$\n`);

		settled(doc, (body) => deleteNode(body, 1, defaultGrammarView));

		expect(serialize(doc)).toBe(`${T}$$\nx\n$$\n`);
		expect(doc.children.map((c) => c.kind)).toEqual(['table', 'mathBlock']);
		expect(describeConvergence(doc)).toBeNull();
	});

	it('an indented line with indented code switched off would be a row, so it takes one', () => {
		const off = createRegistryView({ syntax: { indentedCode: false } }).grammar;
		const doc = parse(`${T}---\n    code\n`, { grammar: off });

		settled(doc, (body) => deleteNode(body, 1, defaultGrammarView), off);

		expect(serialize(doc)).toBe(`${T}\n    code\n`);
		expect(describeConvergence(doc, off)).toBeNull();
	});
});
