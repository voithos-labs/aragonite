import { describe, it, expect, vi } from 'vitest';
import { mergedElseFocusNext, mergedElseFocusPrevious } from '$lib/editor-actions/merge-fallback';
import { CURSOR_END, CURSOR_START } from '$lib/block-component';
import { mockRef } from '$lib/test/harness/editor-actions';

// The single owner of the interior-merge fallbacks, shared by block-edit-core's two merge
// interiors and unwrap-strategies.listItemCascadeMiddle. Pinned here so a dropped focus call
// fails at the source, not in a caller.

describe('mergedElseFocusPrevious', () => {
	it('focuses the previous block at its end when the merge found no target', () => {
		const focus = vi.fn();
		const result = mergedElseFocusPrevious(null, mockRef({ focus }));

		expect(result).toBeNull();
		expect(focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('leaves focus untouched and returns the merge point when a target was found', () => {
		const focus = vi.fn();
		const mergePoint = { targetPath: [0, 0], offset: 3 };
		const result = mergedElseFocusPrevious(mergePoint, mockRef({ focus }));

		expect(result).toBe(mergePoint);
		expect(focus).not.toHaveBeenCalled();
	});

	it('is a safe no-op when the previous block is windowed out (undefined ref)', () => {
		expect(mergedElseFocusPrevious(null, undefined)).toBeNull();
	});
});

describe('mergedElseFocusNext', () => {
	it('focuses the block that stayed when the door refused the join', () => {
		const focus = vi.fn();

		expect(mergedElseFocusNext({ op: 'noop' }, mockRef({ focus }))).toBe(false);
		expect(focus).toHaveBeenCalledWith(CURSOR_START);
	});

	it('leaves focus to the caller when the join happened', () => {
		const focus = vi.fn();

		expect(
			mergedElseFocusNext({ op: 'replace', at: 0, count: 2, newCount: 1 }, mockRef({ focus }))
		).toBe(true);
		expect(focus).not.toHaveBeenCalled();
	});

	it('is a safe no-op when the next block is windowed out (undefined ref)', () => {
		expect(mergedElseFocusNext({ op: 'noop' }, undefined)).toBe(false);
	});
});
