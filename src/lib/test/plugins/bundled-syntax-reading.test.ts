// @vitest-environment jsdom
// The bundled syntax plugins the page-wide suites read with: each construct reads as its plugin
// value's kind through the shared grammar and through a mounted editor listing them, never as the
// prose or generic box a grammar without them reads.
// Miss-analysis: the suites installed harness copies registered page-wide, so nothing held them to
// the values that ship, and a suite reading without the grammar stayed green on prose.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CstNode, InlineNode } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { getContentRange, parseInline } from '#lib/core/inline/index.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import { mountCase } from '#lib/test/range-laws/gestures.js';
import { syntaxGrammar } from '../support/syntax-grammar';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const SOURCE = [
	':::note\na\n:::',
	'> [!NOTE]\n> b',
	'<details>\n<summary>S</summary>\n\nc\n\n</details>',
	'$$\nx^2\n$$',
	'd $y$ e[^1]',
	'[^1]: f'
].join('\n\n');

const KINDS = [
	'admonitions/admonition',
	'admonitions/alert',
	'details/details',
	'details/details.title',
	'latex/block',
	'latex/math',
	'footnotes/ref',
	'footnotes/definition'
];

function kindsIn(nodes: readonly CstNode[], grammar: GrammarView): string[] {
	return nodes.flatMap((node) => {
		if (node.children) return [node.kind, ...kindsIn(node.children, grammar)];
		const { start, end } = getContentRange(node);
		const inline = (list: readonly InlineNode[]): string[] =>
			list.flatMap((n) => [n.kind, ...inline(n.children ?? [])]);
		return [node.kind, ...inline(parseInline(node.raw, start, end, undefined, grammar))];
	});
}

describe('the bundled syntax plugins', () => {
	it('read as their values’ kinds through the shared grammar', () => {
		const grammar = syntaxGrammar();
		expect(kindsIn(parse(SOURCE, { grammar }).children, grammar)).toEqual(
			expect.arrayContaining(KINDS)
		);
	});

	it('read as their values’ kinds in a mounted editor listing them', async () => {
		const editor = mountCase(SOURCE, 'source');
		await editor.settle();
		const { getDocument, getGrammar } = editor.instance.__test;
		expect(kindsIn(getDocument().children, getGrammar())).toEqual(expect.arrayContaining(KINDS));
	});

	// The values held for the page, a bare parse still reads none of them.
	it('read as none of them through the default grammar', () => {
		syntaxGrammar();
		const found = kindsIn(parse(SOURCE).children, defaultGrammarView);
		expect(found.filter((kind) => KINDS.includes(kind))).toEqual([]);
	});
});
