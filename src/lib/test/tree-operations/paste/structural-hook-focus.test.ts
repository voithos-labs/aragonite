import { describe, it, expect } from 'vitest';
import { defaultStructuralHook, pastedContentFocusIndex } from '$lib/tree-operations/paste/hooks';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';

// The caret lands at the end of the PASTED content, not the trailing residue
// buildPastedReplacement appends as the last node.

const para = (raw: string): CstNode => parse(raw).children[0];
const twoBlocks = (): CstNode[] => parse('one\n\ntwo\n').children;

describe('defaultStructuralHook — caret at end of pasted content', () => {
	it('mid-paragraph paste focuses the last pasted block, not the trailing residue', () => {
		const result = defaultStructuralHook(para('hello world\n'), 5, twoBlocks());
		expect(result.replacement).toHaveLength(4);
		expect(result.focusReplacementIndex).toBe(result.replacement.length - 2);
		expect((result.replacement[result.focusReplacementIndex].raw ?? '').trim()).toBe('two');
	});

	it('end-of-block paste (no residue) focuses the last node unchanged', () => {
		const result = defaultStructuralHook(para('hello\n'), 5, twoBlocks());
		expect(result.replacement).toHaveLength(3);
		expect(result.focusReplacementIndex).toBe(result.replacement.length - 1);
		expect((result.replacement[result.focusReplacementIndex].raw ?? '').trim()).toBe('two');
	});
});

describe('pastedContentFocusIndex', () => {
	it('mid-block yields length-2, end-of-block yields length-1', () => {
		const node = para('hello world\n');
		expect(pastedContentFocusIndex(node, 5, undefined, 4)).toBe(2);
		expect(pastedContentFocusIndex(node, 11, undefined, 3)).toBe(2);
	});

	it('accounts for a pre-delete range', () => {
		const node = para('hello world\n');
		expect(pastedContentFocusIndex(node, 5, { start: 2, end: 5 }, 3)).toBe(1);
		expect(pastedContentFocusIndex(node, 5, { start: 2, end: 11 }, 2)).toBe(1);
	});
});
