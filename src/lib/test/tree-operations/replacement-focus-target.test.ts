import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { focusTargetInReplacement } from '../../tree-operations';

describe('focusTargetInReplacement', () => {
	it('maps an offset inside the first block to that block', () => {
		const nodes = parse('foo\\\n# bar\n').children;
		expect(focusTargetInReplacement(nodes, 2)).toEqual({ index: 0, offset: 2 });
	});

	it('maps an offset in a later block to a local offset (skipping its trivia)', () => {
		// '```\nx\n```\n\nhello\n' → fence body [0,9], blank line, paragraph [11,16]
		const nodes = parse('```\nx\n```\n\nhello\n').children;
		expect(focusTargetInReplacement(nodes, 16)).toEqual({ index: 1, offset: 5 });
	});

	it('lands an offset inside inter-block trivia at the next block start', () => {
		const nodes = parse('```\nx\n```\n\nhello\n').children;
		expect(focusTargetInReplacement(nodes, 10)).toEqual({ index: 1, offset: 0 });
	});

	it('clamps past-the-end offsets to the last block end', () => {
		const nodes = parse('foo\\\n# bar\n').children;
		expect(focusTargetInReplacement(nodes, 999)).toEqual({ index: 1, offset: 5 });
	});

	it('handles an edit position exactly at a block boundary', () => {
		const nodes = parse('foo\\\n# bar\n').children;
		// display end of 'foo\' is offset 4; still block 0
		expect(focusTargetInReplacement(nodes, 4)).toEqual({ index: 0, offset: 4 });
	});
});
