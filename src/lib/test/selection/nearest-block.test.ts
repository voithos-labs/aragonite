// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { blockNearPoint, nearestBand } from '$lib/selection/nearest-block';

// Which block a point off every block belongs to, and where inside it the gesture is answered.
// The geometry half needs real layout and is pinned by e2e/tests/selection/dead-space-click.spec.ts;
// this is the arithmetic, where the off-by-ones live.

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

// The probe coordinates are the load-bearing half for a CHARACTER surface: `endpointAtPoint` and
// the caret landing hit-test at them, and the caller's own off-block point resolves to no offset
// at all there — the miss that made a coalesced drag drop its selection.
describe('blockNearPoint', () => {
	const BOXES = [
		{ left: 100, right: 300, top: 100, bottom: 140 },
		{ left: 100, right: 300, top: 150, bottom: 200 }
	];
	let root: HTMLElement;
	const origFromPoint = document.elementFromPoint;

	beforeEach(() => {
		root = document.createElement('div');
		document.body.appendChild(root);
		BOXES.forEach((box, index) => {
			const block = document.createElement('div');
			block.setAttribute('data-block-path', JSON.stringify([index]));
			block.getBoundingClientRect = () => box as DOMRect;
			root.appendChild(block);
		});
		document.elementFromPoint = ((x: number, y: number) => {
			const index = BOXES.findIndex(
				(b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom
			);
			return index === -1 ? null : root.children[index];
		}) as typeof document.elementFromPoint;
	});

	afterEach(() => {
		document.elementFromPoint = origFromPoint;
		root.remove();
	});

	it('hands back a direct hit at the caller’s own point', () => {
		expect(blockNearPoint(root, 120, 120)).toEqual({
			hit: expect.objectContaining({ path: [0] }),
			probeX: 120,
			probeY: 120
		});
	});

	it('answers a point below the last block at its trailing corner', () => {
		expect(blockNearPoint(root, 120, 900)).toEqual({
			hit: expect.objectContaining({ path: [1] }),
			probeX: 299,
			probeY: 199
		});
	});

	// Beside a block the y is already in its band, so only x moves: the row the pointer is
	// level with, at its near edge.
	it('answers a point in a side gutter at the block’s near edge', () => {
		expect(blockNearPoint(root, 10, 170)).toMatchObject({ probeX: 101, probeY: 170 });
		expect(blockNearPoint(root, 900, 170)).toMatchObject({ probeX: 299, probeY: 170 });
	});

	it('declines when nothing is mounted', () => {
		root.replaceChildren();
		expect(blockNearPoint(root, 10, 10)).toBeNull();
	});
});
