// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { blockNearPoint, nearestBand } from '$lib/selection/nearest-block';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';

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

// Where the endpoint gets hit-tested. The probe point is deliberately not returned, so this is
// its only observation point: a coordinate-addressed kind records the point its own hook was
// handed. A raw off-block point resolves to no offset at all on a character surface, which is
// what dropped a coalesced drag's whole gesture.
describe('blockNearPoint', () => {
	const BOXES = [
		{ left: 100, right: 300, top: 100, bottom: 140 },
		{ left: 100, right: 300, top: 150, bottom: 200 }
	];
	const CELL = 7;
	let root: HTMLElement;
	let probes: { x: number; y: number }[];
	const origFromPoint = document.elementFromPoint;

	beforeEach(() => {
		probes = [];
		const kind = declarePluginKind('probeRecordingKind');
		registerBlockKind(kind, {
			gapEdges: 'none',
			mergeRole: 'not-mergeable',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			foreignDragHitTest: (_wrapper, x, y) => {
				probes.push({ x, y });
				return CELL;
			}
		});

		root = document.createElement('div');
		document.body.appendChild(root);
		BOXES.forEach((box, index) => {
			const block = document.createElement('div');
			block.setAttribute('data-block-path', JSON.stringify([index]));
			block.setAttribute('data-block-kind', kind);
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
		__resetSchemaRegistriesForTests();
	});

	function cellIn(path: number[]) {
		return { path, offset: CELL, cellCoordinate: true };
	}

	it('hands back a direct hit, hit-tested at the caller’s own point', () => {
		const near = blockNearPoint(root, 120, 120);

		expect(near?.path).toEqual([0]);
		expect(near?.endpointHere()).toEqual(cellIn([0]));
		expect(probes).toEqual([{ x: 120, y: 120 }]);
	});

	it('answers a point below the last block at its trailing corner', () => {
		const near = blockNearPoint(root, 120, 900);

		expect(near?.path).toEqual([1]);
		expect(near?.endpointHere()).toEqual(cellIn([1]));
		expect(probes).toEqual([{ x: 299, y: 199 }]);
	});

	// Beside a block the y is already in its band, so only x moves: the row the pointer is
	// level with, at its near edge.
	it('answers a point in a side gutter at the block’s near edge', () => {
		blockNearPoint(root, 10, 170)?.endpointHere();
		blockNearPoint(root, 900, 170)?.endpointHere();

		expect(probes).toEqual([
			{ x: 101, y: 170 },
			{ x: 299, y: 170 }
		]);
	});

	// The drag's same-path branch resolves no endpoint at all, and a character hit-test forces
	// layout, so resolving one eagerly would charge every frame of a drag inside one block.
	it('resolves no endpoint until asked', () => {
		blockNearPoint(root, 120, 900);

		expect(probes).toEqual([]);
	});

	it('declines when nothing is mounted', () => {
		root.replaceChildren();
		expect(blockNearPoint(root, 10, 10)).toBeNull();
	});
});
