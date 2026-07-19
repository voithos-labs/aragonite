import { describe, it, expect } from 'vitest';
import { defaultStructuralHook } from '$lib/tree-operations/paste/hooks';
import { materializeBlankLines } from '$lib/tree-operations/paste/strategy';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';

// A block-boundary structural paste routes through the same two steps dispatch
// uses: materializeBlankLines turns the clipboard's internal blank line into a
// real empty-paragraph row, then buildPastedReplacement splices it against the
// target leaf. The row is a live block (it renders — see the
// paste-materializes-blank-lines E2E), so the live-CST count exceeds the
// reparse count, which folds blank lines back into trivia. These pins guard the
// two ends: the blank-line row survives, and no empty-raw ('') node is ever
// minted — an end-of-block paste has no trailing residue to append.

const para = (raw: string): CstNode => parse(raw).children[0];
const clipboard = (): CstNode[] =>
	materializeBlankLines(parse('# Heading\n\nNew paragraph\n').children);
const raws = (nodes: CstNode[]): string[] => nodes.map((n) => n.raw ?? '');

describe('structural paste at a block boundary', () => {
	it('paste at block END keeps the materialized blank-line row and appends no residue', () => {
		const result = defaultStructuralHook(para('Hello\n'), 5, clipboard());
		expect(result.replacement.map((n) => n.kind)).toEqual([
			'paragraph', // Hello (leading slice)
			'heading', // # Heading
			'paragraph', // materialized blank-line row
			'paragraph' // New paragraph
		]);
		expect(result.replacement[2].raw).toBe('\n'); // the row is a blank line, not empty
		expect(raws(result.replacement)).not.toContain(''); // no phantom node
		expect(result.focusReplacementIndex).toBe(3); // last node — no trailing residue
	});

	it('paste at block START mints no leading phantom and trails the original content', () => {
		const result = defaultStructuralHook(para('Hello\n'), 0, clipboard());
		expect(result.replacement.map((n) => n.kind)).toEqual([
			'heading',
			'paragraph', // materialized blank-line row
			'paragraph', // New paragraph
			'paragraph' // Hello (trailing residue — original content, non-empty)
		]);
		expect(raws(result.replacement)).not.toContain('');
		expect((result.replacement[3].raw ?? '').trim()).toBe('Hello');
		expect(result.focusReplacementIndex).toBe(2); // end of pasted content, before the residue
	});
});
