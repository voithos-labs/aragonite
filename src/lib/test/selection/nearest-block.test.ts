// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { blockNearPoint, descendToLevelChild, nearestBand } from '$lib/selection/nearest-block';
import { blockAtPoint } from '$lib/selection/block-hit-test';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testLeaf } from '$lib/test/harness/test-kinds';

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
// its only observation point: a grid kind records the point its own hook was handed. An
// unclamped off-block point resolves to no offset at all on a text block, which would drop a
// whole drag gesture whose moves were coalesced into one.
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
		const kind = testLeaf('probeRecordingKind', {
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

// Which child a point on a container's own box is handed to. The layout comes from
// e2e/tests/selection/dead-space-click-containers.spec.ts; this pins the choice between the
// container's own text row and its children, which no e2e fixture has on both sides.
describe('descendToLevelChild', () => {
	type Box = { left: number; right: number; top: number; bottom: number };
	const CONTAINER: Box = { left: 0, right: 300, top: 100, bottom: 200 };
	const TITLE: Box = { left: 20, right: 300, top: 100, bottom: 120 };
	const CHILDREN: Box[] = [
		{ left: 20, right: 300, top: 120, bottom: 150 },
		{ left: 20, right: 300, top: 160, bottom: 190 }
	];
	let root: HTMLElement;
	let boxes: { el: HTMLElement; box: Box }[];
	const origFromPoint = document.elementFromPoint;

	function mount(withTitle: boolean) {
		root = document.createElement('div');
		document.body.appendChild(root);
		const container = host(root, [0], CONTAINER);
		boxes = [{ el: container, box: CONTAINER }];
		if (withTitle) editable(container, TITLE);
		CHILDREN.forEach((box, i) => {
			const child = host(container, [0, i], box);
			editable(child, box);
			boxes.push({ el: child, box });
		});
		// The innermost block host under the point, as the browser's hit test would find it.
		document.elementFromPoint = ((x: number, y: number) =>
			boxes.findLast(
				({ box }) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
			)?.el ?? null) as typeof document.elementFromPoint;
	}

	function host(parent: HTMLElement, path: number[], box: Box): HTMLElement {
		const el = parent.appendChild(document.createElement('div'));
		el.setAttribute('data-block-path', JSON.stringify(path));
		el.getBoundingClientRect = () => box as DOMRect;
		return el;
	}

	function editable(parent: HTMLElement, box: Box) {
		const el = parent.appendChild(document.createElement('div'));
		el.setAttribute('contenteditable', 'true');
		el.getBoundingClientRect = () => box as DOMRect;
	}

	function descendFrom(x: number, y: number) {
		const hit = blockAtPoint(root, x, y);
		if (!hit) throw new Error('the fixture put no block under the point');
		return descendToLevelChild(root, { hit, x, y });
	}

	afterEach(() => {
		document.elementFromPoint = origFromPoint;
		root.remove();
	});

	it('hands a point in the gutter to the child level with it, not the first one', () => {
		mount(true);
		const landed = descendFrom(5, 170);

		expect(landed.hit.path).toEqual([0, 1]);
		expect(landed).toMatchObject({ x: 21, y: 170 });
	});

	it('keeps a point level with the container’s own text row', () => {
		mount(true);
		expect(descendFrom(5, 110).hit.path).toEqual([0]);
	});

	it('gives a point between children to the nearer one when the container has no text', () => {
		mount(false);
		expect(descendFrom(5, 110).hit.path).toEqual([0, 0]);
		expect(descendFrom(5, 157).hit.path).toEqual([0, 1]);
	});
});
