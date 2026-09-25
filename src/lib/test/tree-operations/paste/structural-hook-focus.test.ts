import { describe, it, expect } from 'vitest';
import { defaultStructuralHook } from '$lib/tree-operations/paste/hooks';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';
import { fixtureReading } from '../../harness/fixture-grammar';

// The caret lands at the end of the pasted content, not the trailing residue
// buildPastedReplacement appends as the last node.

const para = (raw: string): CstNode => parse(raw).children[0];
const twoBlocks = (): CstNode[] => parse('one\n\ntwo\n').children;

describe('defaultStructuralHook: caret at end of pasted content', () => {
	it('mid-paragraph paste focuses the last pasted block, not the trailing residue', () => {
		const result = defaultStructuralHook(
			para('hello world\n'),
			5,
			twoBlocks(),
			undefined,
			fixtureReading(),
			'\n'
		);
		expect(result.replacement).toHaveLength(4);
		expect(result.focusReplacementIndex).toBe(result.replacement.length - 2);
		expect((result.replacement[result.focusReplacementIndex].raw ?? '').trim()).toBe('two');
	});

	it('end-of-block paste (no residue) focuses the last node unchanged', () => {
		const result = defaultStructuralHook(
			para('hello\n'),
			5,
			twoBlocks(),
			undefined,
			fixtureReading(),
			'\n'
		);
		expect(result.replacement).toHaveLength(3);
		expect(result.focusReplacementIndex).toBe(result.replacement.length - 1);
		expect((result.replacement[result.focusReplacementIndex].raw ?? '').trim()).toBe('two');
	});

	// Miss-analysis (GH #436): every fixture's residue was one line, so one residue node was
	// assumed and never checked.
	it('focuses the last pasted block when the residue is several blocks', () => {
		const result = defaultStructuralHook(
			para('abc\n    code\nmore\n'),
			3,
			twoBlocks(),
			undefined,
			fixtureReading(),
			'\n'
		);
		expect(result.replacement.map((n) => n.raw)).toEqual([
			'abc\n',
			'one\n',
			'two\n',
			'    code\n',
			'more\n'
		]);
		expect(result.focusReplacementIndex).toBe(2);
	});
});
