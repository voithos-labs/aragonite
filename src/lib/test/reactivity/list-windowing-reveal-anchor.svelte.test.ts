// @vitest-environment jsdom
// A scroll into view wins over either rule for holding a block still: both corrections have to
// re-assert the target's absolute position after a change, because the browser's own clamping
// outpaces a relative delta while unmounted images still measure about zero.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import type { RevealAnchorPlacement } from '../../reactivity/list-windowing.svelte';
import {
	heightsOracle,
	makePara,
	mountListWindowing,
	type MountListWindowingOptions,
	type MountedListWindowing
} from '../harness/list-windowing.svelte';

const HEIGHTS: Record<string, number> = { b0: 10, b1: 20, b2: 30, b3: 40, b4: 50, b5: 60 };

const sixParas = () => [0, 1, 2, 3, 4, 5].map((i) => makePara(`p${i}\n`));
const sixIds = () => ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];

const topLevel = (index: number): RevealAnchorPlacement => ({
	index,
	block: 'nearest',
	innerOffset: 0,
	height: null
});

/** A root block list over six blocks with heights b0..b5 = 10..60. */
function mountScope(overrides: Partial<MountListWindowingOptions> = {}): MountedListWindowing {
	return mountListWindowing({
		oracle: heightsOracle(HEIGHTS),
		children: sixParas(),
		ids: sixIds(),
		listHeight: 200,
		...overrides
	});
}

describe('list-windowing reveal anchor', () => {
	it('re-asserts the reveal target through a structural rebuild', async () => {
		const children = $state(sixParas());
		const ids = $state(sixIds());
		let revealTarget: RevealAnchorPlacement | null = null;

		const { windowing, cleanup, port } = mountScope({
			children,
			ids,
			getRevealAnchorTarget: () => revealTarget
		});

		// Offsets: b0@0 b1@10 b2@30 b3@60 b4@100 b5@150. Put b1 at the top of the viewport, so the
		// block held by default is not the one being scrolled to.
		await windowing.revealChild(1);
		expect(port.scrollTop()).toBe(10);
		revealTarget = topLevel(5);

		// Delete b3, which sits between the held block and the target, so the stable-id rule
		// corrects by zero while the held block slides 40px up. The scroll into view has to win.
		children.splice(3, 1);
		ids.splice(3, 1);
		revealTarget = topLevel(4);
		flushSync();

		expect(port.scrollTop()).toBe(110);
		cleanup();
	});

	// Miss-analysis: every case here drove a correction (a rebuild or a measure batch); none
	// drove the subtotal a child reports upward, which applies no correction and so had no case to
	// fail when growth inside the target's own container moved it (#32).
	describe('growth reported upward by a nested scope', () => {
		function mountWithTarget() {
			let revealTarget: RevealAnchorPlacement | null = null;
			const scope = mountScope({ getRevealAnchorTarget: () => revealTarget });
			return { ...scope, claim: (t: RevealAnchorPlacement | null) => (revealTarget = t) };
		}

		// b2 grows from 30 to 130, entirely above the target, so b4's offset moves from 100 to 200.
		const GROW_INDEX = 2;
		const GROWN_TOTAL = 130;
		const TARGET = 4;

		it('re-asserts the pin while a reveal claim is live', async () => {
			const { windowing, cleanup, port, claim } = mountWithTarget();
			await windowing.revealChild(TARGET);
			expect(port.scrollTop()).toBe(100);
			claim(topLevel(TARGET));

			windowing.setChildSubtotal(GROW_INDEX, GROWN_TOTAL);

			expect(port.scrollTop()).toBe(200);
			cleanup();
		});

		it('stays correction-free with no claim live (no cascade up the chain)', async () => {
			const { windowing, cleanup, port } = mountWithTarget();
			await windowing.revealChild(TARGET);

			windowing.setChildSubtotal(GROW_INDEX, GROWN_TOTAL);

			expect(port.scrollTop()).toBe(100);
			cleanup();
		});
	});

	// A target inside a container is not the container: re-asserting the ancestor's top pushes
	// the target a container's height out of view on the next measure pass.
	const NESTED = { innerOffset: 35, height: 8 };
	const NESTED_CASES: Array<[RevealAnchorPlacement['block'], number, number]> = [
		// b5 lands at 110 after the delete; the target sits 35px into it.
		['nearest', 500, 145],
		// Centred on the target's own box: the ancestor's height of 60 would place it 26px off.
		['center', 100, 145 - (100 - NESTED.height) / 2]
	];
	for (const [block, viewport, expected] of NESTED_CASES) {
		it(`re-asserts a nested '${block}' target at its own position inside the ancestor`, async () => {
			const children = $state(sixParas());
			const ids = $state(sixIds());
			let revealTarget: RevealAnchorPlacement | null = null;

			const { windowing, cleanup, port } = mountScope({
				children,
				ids,
				viewportHeight: viewport,
				listHeight: 80,
				getRevealAnchorTarget: () => revealTarget
			});

			await windowing.revealChild(1);
			expect(port.scrollTop()).toBe(10);

			children.splice(3, 1);
			ids.splice(3, 1);
			revealTarget = { index: 4, block, ...NESTED };
			flushSync();

			expect(port.scrollTop()).toBe(expected);
			cleanup();
		});
	}
});

// `revealHoldsScroll` asks whether `placeRevealTarget()` would do nothing right now, not
// whether a claim exists: the second answers true over a target nothing is holding, and another
// writer that trusted it would move the user instead of compensating them. Two rows below are
// unreachable from the e2e harness (the observer never wins the race in a real trace, and the
// clamped case needs a document shorter than its target).
describe('revealHoldsScroll — the orderings a second writer can land in', () => {
	const HEADER_BEFORE = 80;
	const HEADER_AFTER = 240;
	const DELTA = HEADER_AFTER - HEADER_BEFORE;
	// Offsets: b0@0 b1@10 b2@30 b3@60 b4@100 b5@150. The target is b4.
	const TARGET_OFFSET = 100;
	const HELD = HEADER_AFTER + TARGET_OFFSET;

	function mount(maxScrollTop = Infinity) {
		let revealTarget: RevealAnchorPlacement | null = null;
		// The layout after the resize: the callback that asks this runs once the header has already
		// grown, so the taller header is what the check measures against.
		const scope = mountScope({
			maxScrollTop,
			chromeAbove: HEADER_AFTER,
			getRevealAnchorTarget: () => revealTarget
		});
		return { ...scope, claim: (t: RevealAnchorPlacement | null) => (revealTarget = t) };
	}

	it('answers true only where the target already sits at its placement', () => {
		const { windowing, cleanup, port, claim } = mount();
		claim(topLevel(4));
		port.setScrollTop(HELD);
		expect(windowing.revealHoldsScroll()).toBe(true);
		cleanup();
	});

	it('answers false when the observer runs first, and the delta then lands on the target', () => {
		const { windowing, cleanup, port, claim } = mount();
		claim(topLevel(4));
		// The last placement was against the short header, and nothing has replaced it yet.
		port.setScrollTop(HEADER_BEFORE + TARGET_OFFSET);
		expect(windowing.revealHoldsScroll()).toBe(false);
		// Which is the whole reason `false` is safe: the relative correction the caller falls back
		// to is not merely harmless here, it is exact.
		port.setScrollTop(port.scrollTop() + DELTA);
		expect(port.scrollTop()).toBe(HELD);
		expect(windowing.revealHoldsScroll()).toBe(true);
		cleanup();
	});

	it('answers false for a claim the anchor never placed', () => {
		const { windowing, cleanup, port, claim } = mount();
		// A `'nearest'` scroll to a block already on screen scrolls nothing, so the claim sits over
		// a target mid-viewport rather than at the position it would hold.
		port.setScrollTop(HELD - 263);
		claim(topLevel(4));
		expect(windowing.revealHoldsScroll()).toBe(false);
		cleanup();
	});

	it('answers false when the placement is clamped beyond the scroll range', () => {
		const { windowing, cleanup, port, claim } = mount(HELD - 40);
		claim(topLevel(4));
		port.setScrollTop(HELD); // refused by the clamp
		expect(port.scrollTop()).toBe(HELD - 40);
		expect(windowing.revealHoldsScroll()).toBe(false);
		cleanup();
	});

	it('answers false with no reveal in flight', () => {
		const { windowing, cleanup, port } = mount();
		port.setScrollTop(HELD);
		expect(windowing.revealHoldsScroll()).toBe(false);
		cleanup();
	});
});
