// @vitest-environment jsdom
// The rect surface's geometry is real only in a browser (pixel reads are e2e-tested),
// but scrollTo's ORCHESTRATION is pure wiring: the reveal-anchor set before mount, the
// mount (revealPath) before the viewport scroll, the block-option default, and presence
// as the resolved value in a bare (no-root) harness. Those regress independently of
// geometry, so they are pinned here with fakes rather than a browser.

import { describe, it, expect, vi } from 'vitest';
import { createEditorRects } from '../../editor-rects';
import type { RevealAnchorState, RevealBlock } from '../../cursor/reveal-anchor';

function makeRects(el: HTMLElement | null) {
	const order: string[] = [];
	const scrollIntoView = vi.fn((_opts?: ScrollIntoViewOptions) => order.push('scroll'));
	if (el) el.scrollIntoView = scrollIntoView;
	const anchorSets: Array<{ path: number[]; block: RevealBlock | undefined }> = [];
	let clears = 0;
	const revealAnchor: RevealAnchorState = {
		get: () => null,
		set: (path, block) => {
			order.push('anchor');
			anchorSets.push({ path, block });
		},
		clear: () => {
			clears++;
		}
	};
	const rects = createEditorRects({
		getBlockElByPath: () => el,
		getBlockComponentByPath: () => null,
		revealPath: async () => {
			order.push('reveal');
		},
		getEditorRoot: () => null,
		getScrollHost: () => null,
		isCrossBlock: () => false,
		revealAnchor
	});
	return { rects, order, scrollIntoView, anchorSets, clears: () => clears };
}

describe('EditorRects.scrollTo', () => {
	it('sets the reveal anchor before revealing, then scrolls', async () => {
		const { rects, order } = makeRects(document.createElement('div'));
		await rects.scrollTo([4]);
		// Anchor before mount is load-bearing: the gesture that triggers a reveal (a
		// Previous-match click) clears the anchor on pointerdown, so the set must land
		// synchronously afterward, before the first await.
		expect(order).toEqual(['anchor', 'reveal', 'scroll']);
	});

	it('anchors the target path at the requested block placement', async () => {
		const { rects, anchorSets } = makeRects(document.createElement('div'));
		await rects.scrollTo([4], { block: 'center' });
		expect(anchorSets).toEqual([{ path: [4], block: 'center' }]);
	});

	it('resolves true and defaults the scroll (and anchor) block to nearest', async () => {
		const { rects, scrollIntoView, anchorSets } = makeRects(document.createElement('div'));
		expect(await rects.scrollTo([4])).toBe(true);
		expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
		expect(anchorSets).toEqual([{ path: [4], block: 'nearest' }]);
	});

	it('resolves false, never scrolls, and clears the anchor when the block does not resolve', async () => {
		const { rects, scrollIntoView, clears } = makeRects(null);
		expect(await rects.scrollTo([99])).toBe(false);
		expect(scrollIntoView).not.toHaveBeenCalled();
		// A failed reveal leaves no dangling pin fighting the next real scroll.
		expect(clears()).toBe(1);
	});
});
