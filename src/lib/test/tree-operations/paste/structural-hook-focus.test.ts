import { describe, it, expect } from 'vitest';
import { defaultStructuralHook, pastedContentFocusIndex } from '$lib/tree-operations/paste/hooks';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';

// A structural mid-block paste lands the caret at the end of the PASTED content,
// not the trailing residue that buildPastedReplacement appends as the last node.
// End-of-block pastes (no residue) are unchanged.

const para = (raw: string): CstNode => parse(raw).children[0];
const twoBlocks = (): CstNode[] => parse('one\n\ntwo\n').children;

describe('defaultStructuralHook — caret at end of pasted content', () => {
	it('mid-paragraph paste focuses the last pasted block, not the trailing residue', () => {
		// [leading "hello", one, two, trailing " world"] — pasted content ends at len-2.
		const result = defaultStructuralHook(para('hello world\n'), 5, twoBlocks());
		expect(result.replacement).toHaveLength(4);
		expect(result.focusReplacementIndex).toBe(result.replacement.length - 2);
		expect((result.replacement[result.focusReplacementIndex].raw ?? '').trim()).toBe('two');
	});

	it('end-of-block paste (no residue) focuses the last node unchanged', () => {
		// offset 5 == end of "hello" → [leading "hello", one, two], no trailing slice.
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
		// delete "llo" (2..5), paste at 2 → " world" residue trails → length-2.
		expect(pastedContentFocusIndex(node, 5, { start: 2, end: 5 }, 3)).toBe(1);
		// delete through the end (2..11) → no residue → length-1.
		expect(pastedContentFocusIndex(node, 5, { start: 2, end: 11 }, 2)).toBe(1);
	});
});
