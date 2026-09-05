// @vitest-environment jsdom
// Miss-analysis: the reveal-anchor arms were all driven through hand-built
// `RevealAnchorPlacement` values, so the resolver that MINTS them from the live DOM had no
// test of its own and its unmounted-target arm was never asked what it answers.
import { describe, it, expect } from 'vitest';
import { placementOf } from '../../reactivity/use-container-windowing.svelte';
import type { BlockElLookup } from '../../editor-keys';

function stubEl(top: number, height: number): HTMLElement {
	return { getBoundingClientRect: () => ({ top, height }) } as unknown as HTMLElement;
}

/** A lookup over a fixed path→element map; every other path is windowed out. */
function lookup(mounted: Record<string, HTMLElement>): BlockElLookup {
	return (path) => mounted[path.join(',')] ?? null;
}

const nested = { path: [4, 2, 1], block: 'nearest' as const };

describe('reveal-anchor placement', () => {
	it('resolves a top-level target without consulting the DOM', () => {
		expect(placementOf({ path: [4], block: 'center' }, lookup({}))).toEqual({
			index: 4,
			block: 'center',
			innerOffset: 0,
			height: null
		});
	});

	it('measures a mounted nested target as a drop inside its ancestor', () => {
		const mounted = { '4': stubEl(100, 300), '4,2,1': stubEl(135, 8) };

		expect(placementOf(nested, lookup(mounted))).toEqual({
			index: 4,
			block: 'nearest',
			innerOffset: 35,
			height: 8
		});
	});

	// The ancestor is all the model can address, and the model is the only thing that knows
	// where a windowed-out block sits — so the shallow placement is the honest answer here.
	it('falls back to the ancestor while the ancestor itself is windowed out', () => {
		expect(placementOf(nested, lookup({}))).toEqual({
			index: 4,
			block: 'nearest',
			innerOffset: 0,
			height: null
		});
	});

	// The red: a mounted container whose target row scrolled out of the container's OWN window.
	// Answering the ancestor's top there re-asserts a different block, teleporting the reader
	// back to the top of the container every time its subtotal report reaches the corrector.
	it('declines when a mounted container has windowed its target out', () => {
		expect(placementOf(nested, lookup({ '4': stubEl(100, 300) }))).toBeNull();
	});
});
