// @vitest-environment jsdom
// A reveal in flight outranks either anchor rule: the target's absolute position is
// re-asserted after the mutation, because the browser's scroll auto-clamp outpaces
// delta compensation while off-window images measure ~0. The numeric corrector
// carried that branch; the STRUCTURAL one (used for every count change and reorder)
// did not, so a structural edit landing during a reveal delta-compensated instead
// and dragged the revealed block off screen.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { createListWindowing, type ListWindowing } from '../../reactivity/list-windowing.svelte';
import type { HeightOracle } from '../../cursor/height-oracle';
import type { CstNode } from '../../core/nodes';
import type { RevealBlock } from '../../cursor/reveal-anchor';

const HEIGHTS: Record<string, number> = { b0: 10, b1: 20, b2: 30, b3: 40, b4: 50, b5: 60 };

const oracle: HeightOracle = {
	estimate: () => 10,
	measured: () => undefined,
	recordMeasured: () => {},
	height: (id: string) => HEIGHTS[id] ?? 10,
	invalidateWidth: () => {},
	clear: () => {}
};

function stubScrollEl(height: number) {
	return {
		scrollTop: 0,
		clientHeight: height,
		clientWidth: 800,
		getBoundingClientRect: () => ({ top: 0, height }),
		addEventListener: () => {},
		removeEventListener: () => {}
	} as unknown as HTMLElement;
}

/** The list scrolls WITH the content, so its viewport top moves by -scrollTop —
 *  without that, `listTopWithinContent` reads the scroll offset twice and the two
 *  anchor rules coincide in the stub while diverging in a browser. */
function stubListEl(height: number, scrollEl: HTMLElement) {
	return {
		scrollTop: 0,
		clientHeight: height,
		clientWidth: 800,
		getBoundingClientRect: () => ({ top: -scrollEl.scrollTop, height }),
		addEventListener: () => {},
		removeEventListener: () => {}
	} as unknown as HTMLElement;
}

const makePara = (raw: string): CstNode => ({ kind: 'paragraph', leadingTrivia: '', raw });

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
		let revealTarget: { index: number; block: RevealBlock } | null = null;

		let windowing!: ListWindowing;
		const cleanup = $effect.root(() => {
			windowing = createListWindowing({
				oracle,
				getChildren: () => children,
				getChildIds: () => ids,
				getListEl: () => listEl,
				getScrollEl: () => scrollEl,
				getFocusPath: () => null,
				getRevealAnchorTarget: () => revealTarget,
				getWidthVersion: () => 0,
				getParentPath: () => [],
				overscan: 2,
				pinExtensionCap: 100,
				activateAbovePx: 1000,
				deactivateBelowPx: 800
			});
		});
		flushSync();

		// Offsets: b0@0 b1@10 b2@30 b3@60 b4@100 b5@150. Park b1 at the viewport top,
		// so the top-of-viewport anchor is NOT the reveal target.
		await windowing.revealChild(1);
		expect(scrollEl.scrollTop).toBe(10);
		revealTarget = { index: 5, block: 'nearest' };

		// Delete b3 — BETWEEN the anchor and the target. The anchor's own offset is
		// unchanged, so the stable-id rule corrects by zero and holds b1 in place
		// while the pinned block slides 40px up the viewport. The reveal claim
		// re-asserts the target instead: b5 now sits at 110.
		children.splice(3, 1);
		ids.splice(3, 1);
		revealTarget = { index: 4, block: 'nearest' };
		flushSync();

		expect(scrollEl.scrollTop).toBe(110);
		cleanup();
	});
});
