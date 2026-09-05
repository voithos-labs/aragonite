import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { focusTargetInReplacement } from '../../tree-operations';
import { settledCaretTarget } from '../../tree-operations/node-ops';

describe('focusTargetInReplacement', () => {
	it('maps an offset inside the first block to that block', () => {
		const nodes = parse('foo\\\n# bar\n').children;
		expect(focusTargetInReplacement(nodes, 2)).toEqual({ index: 0, offset: 2 });
	});

	it('maps an offset in a later block to a local offset (skipping its trivia)', () => {
		// Fence body [0,9], blank line, paragraph [11,16].
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
		// The display end of a trailing backslash is offset 4, still inside block 0.
		expect(focusTargetInReplacement(nodes, 4)).toEqual({ index: 0, offset: 4 });
	});
});

// What each caret door onto the content funnel spends: the settle's window and its text offset.
describe('settledCaretTarget', () => {
	const noFold = { change: { op: 'noop' } as const, textStart: 0 };

	it('keeps the written slot where no fold moved it', () => {
		expect(settledCaretTarget(noFold, 2, 4, [])).toEqual({ index: 2, offset: 4 });
	});

	it('moves to the settled window and carries the absorbed bytes', () => {
		const settled = {
			change: { op: 'replace' as const, at: 0, count: 3, newCount: 1, idMap: { 0: 0 } },
			textStart: 2
		};
		expect(settledCaretTarget(settled, 1, 1, parse('a\nx# h\nb\n').children)).toEqual({
			index: 0,
			offset: 3
		});
	});

	// The multi-block window still descends, and the descent starts behind the absorbed bytes —
	// drop the shift and the same offset lands at the block's start instead of after the `y`.
	it('descends a multi-block window from the absorbed head', () => {
		const settled = {
			change: { op: 'replace' as const, at: 0, count: 3, newCount: 2, idMap: { 0: 0 } },
			textStart: 2
		};
		expect(settledCaretTarget(settled, 1, 4, parse('a\nx\n\ny\nb\n').children)).toEqual({
			index: 1,
			offset: 1
		});
	});
});
