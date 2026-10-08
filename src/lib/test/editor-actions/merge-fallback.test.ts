import { describe, it, expect } from 'vitest';
import { mergedElseNext, mergedElsePrevious } from '#lib/editor-actions/merge-fallback.js';
import { CURSOR_END, CURSOR_START } from '#lib/block-component.js';
import { docPathFrom } from '#lib/cursor/coordinate-spaces.js';

// The one owner of the interior-merge fallbacks, shared by block-edit-core's two merges and
// unwrap-strategies.listItemCascadeMiddle. Tested here so a dropped fallback fails at the
// source, not in a caller.

const joined = { path: docPathFrom([0, 0]), offset: 3 };

describe('mergedElsePrevious', () => {
	it('lands at the previous block’s end when the merge found no target', () => {
		expect(mergedElsePrevious(null, docPathFrom([1]))).toEqual({
			path: [1],
			offset: CURSOR_END
		});
	});

	it('lands at the join when a target was found', () => {
		expect(mergedElsePrevious(joined, docPathFrom([1]))).toBe(joined);
	});
});

describe('mergedElseNext', () => {
	it('lands at the next block’s start when the entry point refused the join', () => {
		expect(mergedElseNext({ op: 'noop' }, joined, docPathFrom([2]))).toEqual({
			path: [2],
			offset: CURSOR_START
		});
	});

	it('lands at the join when the join happened', () => {
		expect(
			mergedElseNext({ op: 'replace', at: 0, count: 2, newCount: 1 }, joined, docPathFrom([2]))
		).toBe(joined);
	});
});
