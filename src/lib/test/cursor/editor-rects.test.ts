// @vitest-environment jsdom
// The rect surface's geometry is real only in a browser (pixel reads are e2e-tested),
// but scrollTo's ORCHESTRATION is pure wiring: the reveal-anchor claim before mount,
// the mount (revealPath) before the viewport scroll, the block-option default, who may
// release the pin, and presence as the resolved value in a bare (no-root) harness.
// Those regress independently of geometry, so they are pinned here with fakes — over
// the REAL anchor state, since claim ownership is half of what is under test.

import { describe, it, expect, vi } from 'vitest';
import { createEditorRects } from '../../editor-rects';
import { createRevealAnchorState, type RevealAnchorState } from '../../cursor/reveal-anchor';

/** `unmountedPath` resolves to no element while every other path resolves to `el` —
 *  the shape a race between a failing reveal and a live one needs. */
function makeRects(el: HTMLElement | null, unmountedPath?: number[]) {
	const order: string[] = [];
	const scrollIntoView = vi.fn((_opts?: ScrollIntoViewOptions) => order.push('scroll'));
	if (el) el.scrollIntoView = scrollIntoView;
	const real = createRevealAnchorState();
	// Real ownership semantics, with the claim call recorded in `order` so the
	// claim-before-mount sequencing stays pinned.
	const revealAnchor: RevealAnchorState = {
		get: real.get,
		claim: (path, block) => {
			order.push('anchor');
			return real.claim(path, block);
		},
		releaseAll: real.releaseAll
	};
	const landCaretAt = vi.fn(async (_path: number[]) => true);
	const rects = createEditorRects({
		getBlockElByPath: (path) =>
			unmountedPath && JSON.stringify(path) === JSON.stringify(unmountedPath) ? null : el,
		getBlockComponentByPath: () => null,
		revealPath: async () => {
			order.push('reveal');
		},
		getEditorRoot: () => null,
		isHostScroll: () => false,
		getClipBounds: () => [],
		isCrossBlock: () => false,
		isHostChrome: () => false,
		revealAnchor,
		landCaretAt
	});
	return { rects, order, scrollIntoView, revealAnchor, landCaretAt };
}

describe('EditorRects.scrollTo', () => {
	it('claims the reveal anchor before revealing, then scrolls', async () => {
		const { rects, order } = makeRects(document.createElement('div'));
		await rects.scrollTo([4]);
		// The claim before mount is load-bearing: the gesture that triggers a reveal (a
		// Previous-match click) releases the anchor on pointerdown, so the claim must
		// land synchronously afterward, before the first await.
		expect(order).toEqual(['anchor', 'reveal', 'scroll']);
	});

	it('anchors the full target path at the requested block placement', async () => {
		const { rects, revealAnchor } = makeRects(document.createElement('div'));
		await rects.scrollTo([4, 2], { block: 'center' });
		// 'center' releases on resolve, so read the pin from inside the reveal.
		expect(revealAnchor.get()).toBeNull();
		await rects.scrollTo([4, 2]);
		expect(revealAnchor.get()).toEqual({ path: [4, 2], block: 'nearest' });
	});

	it('resolves true and defaults the scroll (and anchor) block to nearest', async () => {
		const { rects, scrollIntoView, revealAnchor } = makeRects(document.createElement('div'));
		expect(await rects.scrollTo([4])).toBe(true);
		expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
		expect(revealAnchor.get()).toEqual({ path: [4], block: 'nearest' });
	});

	it('resolves false, never scrolls, and releases the anchor when the block does not resolve', async () => {
		const { rects, scrollIntoView, revealAnchor } = makeRects(null);
		expect(await rects.scrollTo([99])).toBe(false);
		expect(scrollIntoView).not.toHaveBeenCalled();
		// A failed reveal leaves no dangling pin fighting the next real scroll.
		expect(revealAnchor.get()).toBeNull();
	});

	it('hands the pin back on resolve when told not to hold', async () => {
		const { rects, revealAnchor } = makeRects(document.createElement('div'));
		expect(await rects.scrollTo([4], { hold: false })).toBe(true);
		expect(revealAnchor.get()).toBeNull();
	});
});

describe('EditorRects.scrollTo — claim ownership', () => {
	// The residual per-call ownership closes: every terminal release runs through the
	// claim, so a reveal that a later one superseded cannot take the fresher pin with
	// it. Both self-releasing arms are covered — the 'center' refine and the hand-back.
	for (const [name, opts] of [
		['a center refine', { block: 'center' } as const],
		['a hand-back restore', { hold: false } as const]
	] as const) {
		it(`${name} resolving late does not release a pin claimed after it`, async () => {
			const { rects, revealAnchor } = makeRects(document.createElement('div'));
			const stale = rects.scrollTo([4], opts);
			const fresh = rects.scrollTo([9]);
			await stale;
			await fresh;
			expect(revealAnchor.get()).toEqual({ path: [9], block: 'nearest' });
		});
	}

	it('a failed reveal resolving late does not release a pin claimed after it', async () => {
		const { rects, revealAnchor } = makeRects(document.createElement('div'), [99]);
		const stale = rects.scrollTo([99]);
		const fresh = rects.scrollTo([9]);
		expect(await stale).toBe(false);
		await fresh;
		expect(revealAnchor.get()).toEqual({ path: [9], block: 'nearest' });
	});

	it("the user's release outranks the claimant: the pin is gone and the claimant cannot re-take it", async () => {
		const { rects, revealAnchor } = makeRects(document.createElement('div'));
		const pending = rects.scrollTo([4]);
		revealAnchor.releaseAll();
		await pending;
		expect(revealAnchor.get()).toBeNull();
	});
});

describe('EditorRects.navigateTo', () => {
	it('lands the caret at the target through the restore road', async () => {
		const { rects, landCaretAt } = makeRects(document.createElement('div'));
		expect(await rects.navigateTo([4, 1])).toBe(true);
		expect(landCaretAt).toHaveBeenCalledWith([4, 1]);
	});

	it('copies the path so a caller mutating its array cannot re-aim the landing', async () => {
		const { rects, landCaretAt } = makeRects(document.createElement('div'));
		const path = [4, 1];
		const done = rects.navigateTo(path);
		path[1] = 7;
		await done;
		expect(landCaretAt).toHaveBeenCalledWith([4, 1]);
	});
});
