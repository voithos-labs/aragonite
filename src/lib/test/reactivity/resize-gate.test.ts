import { describe, it, expect } from 'vitest';
import { shouldRemeasureOnResize } from '../../reactivity/list-windowing.svelte';

// The resize gate decides whether a ResizeObserver callback should trigger a re-measure.
// Its load-bearing property is that the decision turns on the height difference alone,
// never on which callback delivered it — so an image that decodes between the batch
// measure and the FIRST observer callback (the cached scroll-up-to-a-remounted-image
// case) is still corrected. A callback-order heuristic would silently drop that one.

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
