// @vitest-environment jsdom
// A reveal in flight outranks either anchor rule: the target's absolute position is
// re-asserted after the mutation, because the browser's scroll auto-clamp outpaces
// delta compensation while off-window images measure ~0. The numeric corrector
// carried that branch; the STRUCTURAL one (used for every count change and reorder)
// did not, so a structural edit landing during a reveal delta-compensated instead
// and dragged the revealed block off screen.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import {
	createListWindowing,
	type ListWindowing,
	type RevealAnchorPlacement
} from '../../reactivity/list-windowing.svelte';
import type { HeightOracle } from '../../cursor/height-oracle';
import type { CstNode } from '../../core/nodes';

const HEIGHTS: Record<string, number> = { b0: 10, b1: 20, b2: 30, b3: 40, b4: 50, b5: 60 };

const oracle: HeightOracle = {
	estimate: () => 10,
	measured: () => undefined,
	recordMeasured: () => {},
	height: (id: string) => HEIGHTS[id] ?? 10,
	invalidateWidth: () => {},
	clear: () => {}
};

/** `maxScrollTop` models the browser's own clamp, which a plain property cannot: a
 *  scroll position past the content's end is silently refused, so a target beyond it is
 *  one the anchor can never actually be holding. */
function stubScrollEl(height: number, maxScrollTop = Infinity) {
	let scrollTop = 0;
	return {
		get scrollTop() {
			return scrollTop;
		},
		set scrollTop(v: number) {
			scrollTop = Math.max(0, Math.min(v, maxScrollTop));
		},
		clientHeight: height,
		clientWidth: 800,
		getBoundingClientRect: () => ({ top: 0, height }),
		addEventListener: () => {},
		removeEventListener: () => {}
	} as unknown as HTMLElement;
}

/** The list scrolls WITH the content, so its viewport top moves by -scrollTop —
 *  without that, `listTopWithinContent` reads the scroll offset twice and the two
 *  anchor rules coincide in the stub while diverging in a browser. `headerHeight` is
 *  content ABOVE the list inside the same scrollport (the header slot), which is what
 *  `listTopWithinContent` resolves to. */
function stubListEl(height: number, scrollEl: HTMLElement, headerHeight = 0) {
	return {
		scrollTop: 0,
		clientHeight: height,
		clientWidth: 800,
		getBoundingClientRect: () => ({ top: headerHeight - scrollEl.scrollTop, height }),
		addEventListener: () => {},
		removeEventListener: () => {}
	} as unknown as HTMLElement;
}

const makePara = (raw: string): CstNode => ({ kind: 'paragraph', leadingTrivia: '', raw });

const topLevel = (index: number): RevealAnchorPlacement => ({
	index,
	block: 'nearest',
	innerOffset: 0,
	height: null
});

/** Mount a root scope over six blocks with heights b0..b5 = 10..60. */
function mountScope(
	children: CstNode[],
	ids: string[],
	scrollEl: HTMLElement,
	listEl: HTMLElement,
	getRevealAnchorTarget: () => RevealAnchorPlacement | null
): { windowing: ListWindowing; cleanup: () => void } {
	let windowing!: ListWindowing;
	const cleanup = $effect.root(() => {
		windowing = createListWindowing({
			oracle,
			getChildren: () => children,
			getChildIds: () => ids,
			getListEl: () => listEl,
			getScrollEl: () => scrollEl,
			getFocusPath: () => null,
			getRevealAnchorTarget,
			getWidthVersion: () => 0,
			windowingEnabled: () => true,
			getParentPath: () => [],
			overscan: 2,
			pinExtensionCap: 100,
			activateAbovePx: 1000,
			deactivateBelowPx: 800
		});
	});
	flushSync();
	return { windowing, cleanup };
}

describe('list-windowing reveal anchor', () => {
	it('re-asserts the reveal target through a structural rebuild', async () => {
		const children = $state(
			[0, 1, 2, 3, 4, 5].map((i) =>
				makePara(`p${i}
`)
			)
		);
		const ids = $state(['b0', 'b1', 'b2', 'b3', 'b4', 'b5']);
		const scrollEl = stubScrollEl(500);
		const listEl = stubListEl(200, scrollEl);
		let revealTarget: RevealAnchorPlacement | null = null;

		const { windowing, cleanup } = mountScope(children, ids, scrollEl, listEl, () => revealTarget);

		// Offsets: b0@0 b1@10 b2@30 b3@60 b4@100 b5@150. Park b1 at the viewport top,
		// so the top-of-viewport anchor is NOT the reveal target.
		await windowing.revealChild(1);
		expect(scrollEl.scrollTop).toBe(10);
		revealTarget = topLevel(5);

		// Delete b3 — BETWEEN the anchor and the target. The anchor's own offset is
		// unchanged, so the stable-id rule corrects by zero and holds b1 in place
		// while the pinned block slides 40px up the viewport. The reveal claim
		// re-asserts the target instead: b5 now sits at 110.
		children.splice(3, 1);
		ids.splice(3, 1);
		revealTarget = topLevel(4);
		flushSync();

		expect(scrollEl.scrollTop).toBe(110);
		cleanup();
	});

	// A target nested inside a container is not the container: re-asserting the
	// ancestor's top pushes the resolved target a container-height out of view on the
	// next measure pass, which is what the top-level narrowing used to do. Same
	// structural trigger as above — what differs is where the pin lands.
	const NESTED = { innerOffset: 35, height: 8 };
	const NESTED_CASES: Array<[RevealAnchorPlacement['block'], number, number]> = [
		// b5 lands at 110 after the delete; the target sits 35px into it.
		['nearest', 500, 145],
		// Centred on the TARGET's box: the ancestor's model height (60) would place it 26px off.
		['center', 100, 145 - (100 - NESTED.height) / 2]
	];
	for (const [block, viewport, expected] of NESTED_CASES) {
		it(`re-asserts a nested '${block}' target at its own position inside the ancestor`, async () => {
			const children = $state(
				[0, 1, 2, 3, 4, 5].map((i) =>
					makePara(`p${i}
`)
				)
			);
			const ids = $state(['b0', 'b1', 'b2', 'b3', 'b4', 'b5']);
			const scrollEl = stubScrollEl(viewport);
			const listEl = stubListEl(80, scrollEl);
			let revealTarget: RevealAnchorPlacement | null = null;

			const { windowing, cleanup } = mountScope(
				children,
				ids,
				scrollEl,
				listEl,
				() => revealTarget
			);

			await windowing.revealChild(1);
			expect(scrollEl.scrollTop).toBe(10);

			children.splice(3, 1);
			ids.splice(3, 1);
			revealTarget = { index: 4, block, ...NESTED };
			flushSync();

			expect(scrollEl.scrollTop).toBe(expected);
			cleanup();
		});
	}
});

// `revealHoldsScroll` is what a SECOND writer of the same scrollTop asks before adding a
// relative delta. It is not "is a claim live" — that question is answerable `true` over a
// target the anchor is not holding, and a writer that trusted it would re-place the reader
// instead of compensating them. It is exactly "would `placeRevealTarget()` be a no-op
// right now": same formula, and a ResizeObserver callback runs after layout, so whatever
// just resized is already inside the number both sides compute.
//
// Every row below is deterministic here and two of them are unreachable from the e2e
// harness — the observer never won the race in any trace, and the clamped case needs a
// document shorter than its own reveal target. That gap is what let an authority-based
// first fix ship green.
describe('revealHoldsScroll — the orderings a second writer can land in', () => {
	const HEADER_BEFORE = 80;
	const HEADER_AFTER = 240;
	const DELTA = HEADER_AFTER - HEADER_BEFORE;
	// Offsets: b0@0 b1@10 b2@30 b3@60 b4@100 b5@150. The target is b4.
	const TARGET_OFFSET = 100;
	const HELD = HEADER_AFTER + TARGET_OFFSET;

	function mount(maxScrollTop = Infinity) {
		const children = [0, 1, 2, 3, 4, 5].map((i) => makePara(`p${i}\n`));
		const ids = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];
		const scrollEl = stubScrollEl(500, maxScrollTop);
		// Post-resize layout: the callback that asks this question runs after the header
		// has already grown, so the taller header is what the predicate measures against.
		const listEl = stubListEl(200, scrollEl, HEADER_AFTER);
		let revealTarget: RevealAnchorPlacement | null = null;
		const { windowing, cleanup } = mountScope(children, ids, scrollEl, listEl, () => revealTarget);
		return {
			windowing,
			cleanup,
			scrollEl,
			claim: (t: RevealAnchorPlacement | null) => (revealTarget = t)
		};
	}

	it('answers true only where the target already sits at its placement', () => {
		const { windowing, cleanup, scrollEl, claim } = mount();
		claim(topLevel(4));
		scrollEl.scrollTop = HELD;
		expect(windowing.revealHoldsScroll()).toBe(true);
		cleanup();
	});

	it('answers false when the observer runs first, and the delta then lands on the target', () => {
		const { windowing, cleanup, scrollEl, claim } = mount();
		claim(topLevel(4));
		// The anchor last placed against the SHORT header and has not re-placed yet.
		scrollEl.scrollTop = HEADER_BEFORE + TARGET_OFFSET;
		expect(windowing.revealHoldsScroll()).toBe(false);
		// Which is the whole reason `false` is safe: the relative correction the caller
		// falls back to is not merely harmless here, it is exact.
		scrollEl.scrollTop += DELTA;
		expect(scrollEl.scrollTop).toBe(HELD);
		expect(windowing.revealHoldsScroll()).toBe(true);
		cleanup();
	});

	it('answers false for a claim the anchor never placed', () => {
		const { windowing, cleanup, scrollEl, claim } = mount();
		// A `'nearest'` reveal of an already-visible block scrolls nothing, so the claim
		// rides a target sitting mid-viewport rather than at its pin.
		scrollEl.scrollTop = HELD - 263;
		claim(topLevel(4));
		expect(windowing.revealHoldsScroll()).toBe(false);
		cleanup();
	});

	it('answers false when the placement is clamped beyond the scroll range', () => {
		const { windowing, cleanup, scrollEl, claim } = mount(HELD - 40);
		claim(topLevel(4));
		scrollEl.scrollTop = HELD; // refused by the clamp
		expect(scrollEl.scrollTop).toBe(HELD - 40);
		expect(windowing.revealHoldsScroll()).toBe(false);
		cleanup();
	});

	it('answers false with no reveal in flight', () => {
		const { windowing, cleanup, scrollEl } = mount();
		scrollEl.scrollTop = HELD;
		expect(windowing.revealHoldsScroll()).toBe(false);
		cleanup();
	});
});
