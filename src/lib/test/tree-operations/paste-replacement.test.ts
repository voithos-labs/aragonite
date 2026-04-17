import { describe, it, expect } from 'vitest';
import { buildPastedReplacement } from '../../tree-operations/paste-replacement';
import type { CstNode } from '../../core/nodes';
import { parse } from '../../core/parser';

describe('buildPastedReplacement — blank-line preservation between blocks', () => {
	it('preserves blank line between two pasted paragraphs at end of leaf', () => {
		// Clipboard content: two paragraphs separated by a blank line.
		const parsed = parse('one\n\ntwo\n');
		expect(parsed.children).toHaveLength(2);
		expect(parsed.children[1].leadingTrivia).toBe('\n');

		// Leaf: a paragraph "prefix\n". Caret at end (offset 6).
		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'prefix\n' };
		const replacement = buildPastedReplacement(leaf, 6, parsed.children);

		// Expected: [beforeNode "prefix\n", firstPasted "one\n", lastPasted "two\n"]
		// with the blank line preserved as the last node's leadingTrivia.
		expect(replacement).toHaveLength(3);
		expect(replacement[2].leadingTrivia).toBe('\n');
	});

	it('preserves blank-line trivia on middle pasted blocks', () => {
		// Three paragraphs with blank lines between each.
		const parsed = parse('a\n\nb\n\nc\n');
		expect(parsed.children).toHaveLength(3);
		expect(parsed.children[1].leadingTrivia).toBe('\n');
		expect(parsed.children[2].leadingTrivia).toBe('\n');

		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'x\n' };
		const replacement = buildPastedReplacement(leaf, 1, parsed.children);

		// [beforeNode "x", blocks[0] "a", blocks[1] "b", merged-last "c"]
		expect(replacement).toHaveLength(4);
		// Middle block keeps its blank-line trivia.
		expect(replacement[2].leadingTrivia).toBe('\n');
		// Last block keeps its blank-line trivia.
		expect(replacement[3].leadingTrivia).toBe('\n');
	});
});
