import { describe, it, expect } from 'vitest';
import { shouldRemeasureOnResize } from '../../reactivity/list-windowing.svelte';

// The gate must turn on the height difference alone, never on which callback delivered
// it: an image decoding between the batch measure and the FIRST observer callback is
// a real correction that any callback-order heuristic silently drops.

describe('shouldRemeasureOnResize', () => {
	it('re-measures a grown height even when it arrives in the first observed callback', () => {
		// Batch recorded the collapsed image (20px); the cached image then decoded and the
		// grown box (400px) is the first size the observer reports.
		expect(shouldRemeasureOnResize(20, 400)).toBe(true);
	});

	it('no-ops when the observed height matches the recorded one (the fling mount resize)', () => {
		expect(shouldRemeasureOnResize(400, 400)).toBe(false);
	});

	it('treats sub-pixel differences as measurement noise', () => {
		expect(shouldRemeasureOnResize(400, 400.4)).toBe(false);
		expect(shouldRemeasureOnResize(400, 399.7)).toBe(false);
	});

	it('defers to the batched mount pass when nothing is recorded yet', () => {
		expect(shouldRemeasureOnResize(undefined, 400)).toBe(false);
	});

	it('ignores a zero / unlaid-out observed height', () => {
		expect(shouldRemeasureOnResize(20, 0)).toBe(false);
	});
});
