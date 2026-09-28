// @vitest-environment jsdom
// Miss-analysis: every case used a hand-built root placement, never one from the DOM.
import { describe, it, expect } from 'vitest';
import { placementOf } from '../../reactivity/use-container-windowing.svelte';
import type { BlockElLookup } from '../../editor-keys';

function stubEl(top: number, height: number): HTMLElement {
	return { getBoundingClientRect: () => ({ top, height }) } as unknown as HTMLElement;
}

/** A lookup over a fixed map from path to element; every other path is not mounted. */
function lookup(mounted: Record<string, HTMLElement>): BlockElLookup {
	return (path) => mounted[path.join(',')] ?? null;
}

const nested = [4, 2, 1];

describe('reveal-anchor placement', () => {
	it('resolves a top-level target without consulting the DOM', () => {
		expect(placementOf([4], lookup({}))).toEqual({ index: 4, innerOffset: 0, height: null });
	});

	it('measures a mounted nested target as a drop inside its ancestor', () => {
		const mounted = { '4': stubEl(100, 300), '4,2,1': stubEl(135, 8) };

		expect(placementOf(nested, lookup(mounted))).toEqual({ index: 4, innerOffset: 35, height: 8 });
	});

	// The ancestor is all the height table can address, and the table is the only thing that
	// knows where an unmounted block sits, so the shallow placement is the honest answer here.
	it('falls back to the ancestor while the ancestor itself is windowed out', () => {
		expect(placementOf(nested, lookup({}))).toEqual({ index: 4, innerOffset: 0, height: null });
	});

	// Answering the ancestor's top for a row the container windowed out would re-place a
	// different block, jumping the user back to the container's top.
	it('declines when a mounted container has windowed its target out', () => {
		expect(placementOf(nested, lookup({ '4': stubEl(100, 300) }))).toBeNull();
	});
});
