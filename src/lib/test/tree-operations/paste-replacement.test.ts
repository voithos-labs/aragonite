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

		// [beforeNode "x", blocks[0] "a", blocks[1] "b", trailingNode "c"]
		expect(replacement).toHaveLength(4);
		// Middle block keeps its blank-line trivia.
		expect(replacement[2].leadingTrivia).toBe('\n');
		// Last block keeps its blank-line trivia.
		expect(replacement[3].leadingTrivia).toBe('\n');
	});
});

describe('buildPastedReplacement — structural separator at leading slice boundary', () => {
	it('forces blank-line separator between leading slice and first pasted block', () => {
		// Pre-fix: blocks[0] from a top-of-clipboard parse had leadingTrivia=''.
		// When inserted after a non-empty leading slice, the empty trivia caused
		// the leading slice and the first pasted block to render as one
		// soft-break paragraph rather than two distinct paragraphs.
		const parsed = parse('one\n\ntwo\n');
		expect(parsed.children[0].leadingTrivia).toBe('');

		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'before\n' };
		const replacement = buildPastedReplacement(leaf, 6, parsed.children);

		// First pasted block now carries a forced '\n' separator so it lands
		// as its own paragraph instead of merging with "before".
		expect(replacement[1].raw).toContain('one');
		expect(replacement[1].leadingTrivia).toBe('\n');
	});

	it('does not override an already-meaningful trivia on the first pasted block', () => {
		// If blocks[0] already carries a blank-line trivia, keep it as-is.
		const parsed = parse('\n\nfoo\n');
		// "foo" parses as the first block but with leadingTrivia capturing the
		// preceding blank lines.
		expect(parsed.children).toHaveLength(1);
		const blockWithTrivia = { ...parsed.children[0], leadingTrivia: '\n' };

		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'before\n' };
		const replacement = buildPastedReplacement(leaf, 6, [blockWithTrivia]);

		expect(replacement[1].leadingTrivia).toBe('\n');
	});
});

describe('buildPastedReplacement — trailing slice as separate paragraph', () => {
	it('preserves trailing slice as its own block instead of merging into last pasted', () => {
		// Pre-fix: the trailing slice was concatenated onto the last pasted
		// block's raw and re-parsed, producing a soft-break paragraph
		// ("two\nafter" → one paragraph). For non-paragraph last blocks this
		// was even worse — a list would absorb the trailing text as a
		// continuation line.
		const parsed = parse('one\n\ntwo\n');
		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'before-after\n' };
		const replacement = buildPastedReplacement(leaf, 6, parsed.children);

		// [before, one, two, after] — 4 distinct paragraphs.
		expect(replacement).toHaveLength(4);
		expect(replacement[0].raw.trim()).toBe('before');
		expect(replacement[1].raw.trim()).toBe('one');
		expect(replacement[2].raw.trim()).toBe('two');
		expect(replacement[3].raw.trim()).toBe('-after');
		expect(replacement[3].leadingTrivia).toBe('\n');
	});

	it('preserves trailing slice when last pasted block is a list', () => {
		// Clipboard "alpha\n- bar\n" parses as [paragraph "alpha", list "- bar"].
		// The trailing slice would previously be absorbed into the list as a
		// continuation line; now it stays as its own paragraph.
		const parsed = parse('alpha\n\n- bar\n');
		expect(parsed.children).toHaveLength(2);
		expect(parsed.children[1].kind).toBe('list');

		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'before-after\n' };
		const replacement = buildPastedReplacement(leaf, 6, parsed.children);

		// The last node is the trailing slice (a paragraph "-after"), NOT a
		// list whose item absorbed "after".
		expect(replacement[replacement.length - 1].kind).toBe('paragraph');
		expect(replacement[replacement.length - 1].raw.trim()).toBe('-after');
	});
});
