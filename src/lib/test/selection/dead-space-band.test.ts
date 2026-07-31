import { describe, it, expect } from 'vitest';
import { nearestBand } from '$lib/selection/dead-space-caret';

// Which block a dead-space click belongs to. The geometry half needs real layout and is pinned by
// e2e/tests/selection/dead-space-click.spec.ts; this is the arithmetic, where the off-by-ones live.

const BANDS = [
	{ top: 100, bottom: 130 },
	{ top: 140, bottom: 200 },
	{ top: 210, bottom: 240 }
];

describe('nearestBand', () => {
	it('returns nothing for an empty document', () => {
		expect(nearestBand([], 120)).toBeNull();
	});

	it('marks a click past the last band as the end-of-document gesture', () => {
		expect(nearestBand(BANDS, 600)).toEqual({ index: 2, belowAll: true });
	});

	it('treats the last band edge as inside it, not below', () => {
		expect(nearestBand(BANDS, 240)).toEqual({ index: 2, belowAll: false });
		expect(nearestBand(BANDS, 241)).toEqual({ index: 2, belowAll: true });
	});

	it('resolves a y inside a band to that band, edges included', () => {
		expect(nearestBand(BANDS, 100)).toEqual({ index: 0, belowAll: false });
		expect(nearestBand(BANDS, 170)).toEqual({ index: 1, belowAll: false });
	});

	it('gives a gap between blocks to the nearer side', () => {
		expect(nearestBand(BANDS, 132)).toEqual({ index: 0, belowAll: false });
		expect(nearestBand(BANDS, 138)).toEqual({ index: 1, belowAll: false });
	});

	it('gives a click above the first block to the first block', () => {
		expect(nearestBand(BANDS, 10)).toEqual({ index: 0, belowAll: false });
	});

	// Bands arrive in document order and a container's band contains its children's,
	// so the outermost match must win — the hit test descends to the leaf from there.
	it('prefers the outermost of two nested bands', () => {
		const nested = [
			{ top: 100, bottom: 200 },
			{ top: 110, bottom: 150 }
		];
		expect(nearestBand(nested, 120)).toEqual({ index: 0, belowAll: false });
	});
});
