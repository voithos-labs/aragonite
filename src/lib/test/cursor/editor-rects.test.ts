// @vitest-environment jsdom
// Geometry is real only in a browser (e2e covers the pixels), but the order `scrollTo` does
// things in is plain wiring (claim before mount, mount before scroll, who may release the hold)
// and breaks on its own. Tested with fakes over the real claim state, since ownership is half
// the subject.

import { describe, it, expect, vi } from 'vitest';
import { createEditorRects } from '../../editor-rects';
import { createRevealAnchorState, type RevealAnchorState } from '../../cursor/reveal-anchor';

/** `unmountedPath` resolves to no element while every other path resolves to `el`: the shape
 *  a race between a scroll that fails and one that works needs. */
function makeRects(el: HTMLElement | null, unmountedPath?: number[]) {
	const order: string[] = [];
	const scrollIntoView = vi.fn((_opts?: ScrollIntoViewOptions) => order.push('scroll'));
	if (el) el.scrollIntoView = scrollIntoView;
	const real = createRevealAnchorState();
	// Real ownership rules, with the claim call recorded in `order` so claiming before mounting
	// stays tested.
	const revealAnchor: RevealAnchorState = {
		get: real.get,
		claim: (path, block) => {
			order.push('anchor');
			return real.claim(path, block);
		},
		releaseAll: real.releaseAll
	};
	const landCaretAt = vi.fn(async (_path: number[], _offset: number) => true);
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

// ── Harness for the refinement loop ──────────────────────────────────────────
// `makeRects` passes a null root, so its refinement loop never runs. These give the loop a real
// root and a scriptable top per path: [initialTop, ...topAfterEachScrollIntoView], visible below
// ROOT_BOTTOM, the shape of a first scroll landing short and the loop correcting it.
const ROOT_BOTTOM = 100;
const EL_HEIGHT = 20;

function makeSettlingRects(scripts: Record<string, number[]>) {
	const scrolls: string[] = [];
	const revealAnchor = createRevealAnchorState();
	const positions = new Map<string, { top: number; rest: number[] }>();
	const els = new Map<string, HTMLElement>();
	const harness = {
		rects: null as unknown as ReturnType<typeof createEditorRects>,
		revealAnchor,
		/** Fires on the first scroll of the whole run: the user taking over mid-scroll. */
		onFirstScroll: undefined as (() => void) | undefined,
		scrollCount: (path: number[]) => scrolls.filter((k) => k === JSON.stringify(path)).length
	};

	function elFor(path: number[]): HTMLElement {
		const key = JSON.stringify(path);
		let el = els.get(key);
		if (!el) {
			const [initial, ...rest] = scripts[key] ?? [0];
			const at = { top: initial, rest };
			positions.set(key, at);
			el = document.createElement('div');
			el.getBoundingClientRect = () => ({ top: at.top, bottom: at.top + EL_HEIGHT }) as DOMRect;
			el.scrollIntoView = () => {
				const first = scrolls.length === 0;
				scrolls.push(key);
				if (at.rest.length) at.top = at.rest.shift()!;
				if (first) harness.onFirstScroll?.();
			};
			els.set(key, el);
		}
		return el;
	}

	const root = document.createElement('div');
	root.getBoundingClientRect = () => ({ top: 0, bottom: ROOT_BOTTOM }) as DOMRect;

	harness.rects = createEditorRects({
		getBlockElByPath: elFor,
		getBlockComponentByPath: () => null,
		revealPath: async () => {},
		getEditorRoot: () => root,
		isHostScroll: () => false,
		getClipBounds: () => [],
		isCrossBlock: () => false,
		isHostChrome: () => false,
		revealAnchor,
		landCaretAt: async () => true
	});
	return harness;
}

describe('EditorRects.scrollTo', () => {
	it('claims the reveal anchor before revealing, then scrolls', async () => {
		const { rects, order } = makeRects(document.createElement('div'));
		await rects.scrollTo([4]);
		// The claim must happen synchronously before the first await: the gesture that starts the
		// scroll (a Previous-match click) releases the held block on pointerdown.
		expect(order).toEqual(['anchor', 'reveal', 'scroll']);
	});

	it('anchors the full target path at the requested block placement', async () => {
		const { rects, revealAnchor } = makeRects(document.createElement('div'));
		await rects.scrollTo([4, 2], { block: 'center' });
		// 'center' releases once it resolves, so read the hold from inside the scroll.
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
		// A scroll that failed leaves nothing held to fight the next real scroll.
		expect(revealAnchor.get()).toBeNull();
	});

	it('hands the pin back on resolve when told not to hold', async () => {
		const { rects, revealAnchor } = makeRects(document.createElement('div'));
		expect(await rects.scrollTo([4], { hold: false })).toBe(true);
		expect(revealAnchor.get()).toBeNull();
	});
});

describe('EditorRects.scrollTo — claim ownership', () => {
	// Every final release runs through the claim, so a scroll another one took over cannot take
	// the newer hold with it. Both cases that release themselves are covered: the 'center'
	// refinement and the hand-back.
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

// Why a claim was lost decides whether the refinement keeps working: another scroll owns the
// viewport, while the user taking over ends only the lasting hold, and must not report a
// restore that had not finished arriving as one that never would.
describe('EditorRects.scrollTo — the settle, and who may end it', () => {
	it('a superseded reveal stops scrolling for its own target and reports it out of view', async () => {
		const h = makeSettlingRects({ '[1]': [500, 0], '[2]': [500, 0] });
		const stale = h.rects.scrollTo([1]);
		const fresh = h.rects.scrollTo([2]);

		expect(await stale).toBe(false);
		expect(await fresh).toBe(true);
		// Zero, not "fewer": the scroll before the loop is also checked against the claim, so one
		// taken over during its mount wait never yanks the viewport at all.
		expect(h.scrollCount([1])).toBe(0);
		expect(h.scrollCount([2])).toBeGreaterThan(0);
	});

	it('a user release mid-reveal leaves the settle running, so the target still lands in view', async () => {
		// The first scroll lands short (the script holds the target at 500) and the user takes over
		// exactly then; only the refinement brings it into view.
		const h = makeSettlingRects({ '[1]': [500, 500, 0] });
		h.onFirstScroll = () => h.revealAnchor.releaseAll();

		expect(await h.rects.scrollTo([1])).toBe(true);
		expect(h.revealAnchor.get()).toBeNull();
	});
});

describe('EditorRects.navigateTo', () => {
	it('lands the caret at the target through the restore road', async () => {
		const { rects, landCaretAt } = makeRects(document.createElement('div'));
		expect(await rects.navigateTo([4, 1])).toBe(true);
		expect(landCaretAt).toHaveBeenCalledWith([4, 1], 0);
	});

	it('carries an offset to the landing, for a caller aiming past the block start', async () => {
		const { rects, landCaretAt } = makeRects(document.createElement('div'));
		expect(await rects.navigateTo([4, 1], 13)).toBe(true);
		expect(landCaretAt).toHaveBeenCalledWith([4, 1], 13);
	});

	it('copies the path so a caller mutating its array cannot re-aim the landing', async () => {
		const { rects, landCaretAt } = makeRects(document.createElement('div'));
		const path = [4, 1];
		const done = rects.navigateTo(path);
		path[1] = 7;
		await done;
		expect(landCaretAt).toHaveBeenCalledWith([4, 1], 0);
	});
});
