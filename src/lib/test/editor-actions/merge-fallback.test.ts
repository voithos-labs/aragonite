import { describe, it, expect, vi } from 'vitest';
import { mergedElseFocusPrevious } from '$lib/editor-actions/merge-fallback';
import { CURSOR_END } from '$lib/block-component';
import { mockRef } from '../harness/editor-actions';

// The single owner of the interior-merge no-target fallback, shared by
// block-edit-core.mergeWithPreviousInterior and unwrap-strategies.listItemCascadeMiddle.
// Pinned here so a dropped focus call fails at the source, not in either caller.

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
