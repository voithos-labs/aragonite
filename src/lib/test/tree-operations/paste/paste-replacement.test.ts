import { describe, it, expect } from 'vitest';
import { buildPastedReplacement } from '$lib/tree-operations/paste/paste-replacement';
import type { CstNode } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { plainFragmentReader } from '$lib/tree-operations/list/task-paragraph';

describe('buildPastedReplacement: blank-line preservation between blocks', () => {
	it('preserves blank line between two pasted paragraphs at end of leaf', () => {
		const parsed = parse('one\n\ntwo\n');
		expect(parsed.children).toHaveLength(2);
		expect(parsed.children[1].leadingTrivia).toBe('\n');

		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'prefix\n' };
		const { nodes: replacement } = buildPastedReplacement(
			leaf,
			6,
			parsed.children,
			'\n',
			defaultGrammarView,
			plainFragmentReader(defaultGrammarView)
		);

		expect(replacement).toHaveLength(3);
		expect(replacement[2].leadingTrivia).toBe('\n');
	});

	it('preserves the blank-line separator on middle pasted blocks', () => {
		const parsed = parse('a\n\nb\n\nc\n');
		expect(parsed.children).toHaveLength(3);
		expect(parsed.children[1].leadingTrivia).toBe('\n');
		expect(parsed.children[2].leadingTrivia).toBe('\n');

		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'x\n' };
		const { nodes: replacement } = buildPastedReplacement(
			leaf,
			1,
			parsed.children,
			'\n',
			defaultGrammarView,
			plainFragmentReader(defaultGrammarView)
		);

		expect(replacement).toHaveLength(4);
		expect(replacement[2].leadingTrivia).toBe('\n');
		expect(replacement[3].leadingTrivia).toBe('\n');
	});
});

describe('buildPastedReplacement: structural separator at leading slice boundary', () => {
	it('forces blank-line separator between leading slice and first pasted block', () => {
		const parsed = parse('one\n\ntwo\n');
		expect(parsed.children[0].leadingTrivia).toBe('');

		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'before\n' };
		const { nodes: replacement } = buildPastedReplacement(
			leaf,
			6,
			parsed.children,
			'\n',
			defaultGrammarView,
			plainFragmentReader(defaultGrammarView)
		);

		expect(replacement[1].raw).toContain('one');
		expect(replacement[1].leadingTrivia).toBe('\n');
	});

	it('does not override already-meaningful blank lines on the first pasted block', () => {
		const parsed = parse('bar\n\nfoo\n');
		expect(parsed.children[1].leadingTrivia).toBe('\n');
		const blockWithTrivia = { ...parsed.children[1] };

		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'before\n' };
		const { nodes: replacement } = buildPastedReplacement(
			leaf,
			6,
			[blockWithTrivia],
			'\n',
			defaultGrammarView,
			plainFragmentReader(defaultGrammarView)
		);

		expect(replacement[1].leadingTrivia).toBe('\n');
	});
});

describe('buildPastedReplacement: cursor at offset 0 (no leading slice)', () => {
	it('does not emit a leading slice node when offset is 0', () => {
		const parsed = parse('one\n\ntwo\n');
		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '\n', raw: 'tail\n' };
		const { nodes: replacement } = buildPastedReplacement(
			leaf,
			0,
			parsed.children,
			'\n',
			defaultGrammarView,
			plainFragmentReader(defaultGrammarView)
		);

		expect(replacement).toHaveLength(3);
		expect(replacement[0].raw.trim()).toBe('one');
		expect(replacement[0].leadingTrivia).toBe('\n');
		expect(replacement[1].raw.trim()).toBe('two');
		expect(replacement[2].raw.trim()).toBe('tail');
	});

	it('inherits originalTrivia on the first pasted block when offset is 0', () => {
		const parsed = parse('A\nB\n');
		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '\n\n', raw: 'existing\n' };
		const { nodes: replacement } = buildPastedReplacement(
			leaf,
			0,
			parsed.children,
			'\n',
			defaultGrammarView,
			plainFragmentReader(defaultGrammarView)
		);

		expect(replacement[0].leadingTrivia).toBe('\n\n');
	});
});

describe('buildPastedReplacement, trailing slice as separate paragraph', () => {
	it('preserves trailing slice as its own block instead of merging into last pasted', () => {
		const parsed = parse('one\n\ntwo\n');
		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'before-after\n' };
		const { nodes: replacement } = buildPastedReplacement(
			leaf,
			6,
			parsed.children,
			'\n',
			defaultGrammarView,
			plainFragmentReader(defaultGrammarView)
		);

		expect(replacement).toHaveLength(4);
		expect(replacement[0].raw.trim()).toBe('before');
		expect(replacement[1].raw.trim()).toBe('one');
		expect(replacement[2].raw.trim()).toBe('two');
		expect(replacement[3].raw.trim()).toBe('-after');
		expect(replacement[3].leadingTrivia).toBe('\n');
	});

	it('preserves trailing slice when last pasted block is a list', () => {
		const parsed = parse('alpha\n\n- bar\n');
		expect(parsed.children).toHaveLength(2);
		expect(parsed.children[1].kind).toBe('list');

		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'before-after\n' };
		const { nodes: replacement } = buildPastedReplacement(
			leaf,
			6,
			parsed.children,
			'\n',
			defaultGrammarView,
			plainFragmentReader(defaultGrammarView)
		);

		expect(replacement[replacement.length - 1].kind).toBe('paragraph');
		expect(replacement[replacement.length - 1].raw.trim()).toBe('-after');
	});
});

// Miss-analysis (GH #554): every multi-block clipboard here had a blank line between its blocks,
// so no test saw a flush pair the clipboard parse had already proved stands.
describe('buildPastedReplacement: the clipboard keeps the joins between its own blocks', () => {
	const pasted = (clipboard: string, host = 'hello world\n', offset = 5) => {
		const leaf = parse(host).children[0];
		const blocks = parse(clipboard).children;
		return buildPastedReplacement(
			leaf,
			offset,
			blocks,
			'\n',
			defaultGrammarView,
			plainFragmentReader(defaultGrammarView)
		).nodes;
	};
	const bytes = (nodes: CstNode[]) => nodes.map((n) => n.leadingTrivia + n.raw).join('');

	it.each([
		['a heading over a paragraph, flush', '# T\nbody', 'hello\n\n# T\nbody\n world\n'],
		['two paragraphs apart', 'a\n\nb', 'hello\n\na\n\nb\n world\n'],
		['a heading over a list, flush', '# T\n- x\n- y', 'hello\n\n# T\n- x\n- y\n world\n']
	])('%s', (_name, clipboard, expected) => {
		const nodes = pasted(clipboard);
		expect(bytes(nodes)).toBe(expected);
	});

	it('still gives the first block a blank line where it lands flush under the leaf', () => {
		const nodes = pasted('# T\nbody');
		expect(nodes[1].leadingTrivia).toBe('\n');
	});
});
