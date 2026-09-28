// @vitest-environment jsdom
// A scroll into view takes the one placement slot before its mount and scrolls after. Who holds
// the slot, and who may drop it, decides whether an older scroll can undo a newer one's hold.
import { describe, it, expect, vi } from 'vitest';
import { stubScrollOwner, stubScrollport } from '../harness/stub-scrollport';

const ROOT_BOTTOM = 100;
const EL_HEIGHT = 20;

/** An owner over blocks whose top follows a script per path: [initialTop, ...topAfterEachScroll].
 *  With `withRoot` false there is no editor root, so the follow loop never runs. */
function makeOwner(scripts: Record<string, number[]> = {}, opts: { withRoot?: boolean } = {}) {
	const scrolls: string[] = [];
	const els = new Map<string, HTMLElement>();
	const harness = {
		/** Fires on the first scroll of the whole run: the user taking over mid-scroll. */
		onFirstScroll: undefined as (() => void) | undefined,
		scrollCount: (path: number[]) => scrolls.filter((k) => k === JSON.stringify(path)).length,
		scrollOpts: vi.fn((_opts?: ScrollIntoViewOptions) => {})
	};

	function elFor(path: number[]): HTMLElement | null {
		const key = JSON.stringify(path);
		if (!(key in scripts) && Object.keys(scripts).length > 0) return null;
		let el = els.get(key);
		if (!el) {
			const [initial, ...rest] = scripts[key] ?? [0];
			const at = { top: initial, rest };
			el = document.createElement('div');
			el.getBoundingClientRect = () => ({ top: at.top, bottom: at.top + EL_HEIGHT }) as DOMRect;
			el.scrollIntoView = (o?: ScrollIntoViewOptions | boolean) => {
				const first = scrolls.length === 0;
				scrolls.push(key);
				harness.scrollOpts(o as ScrollIntoViewOptions);
				if (at.rest.length) at.top = at.rest.shift()!;
				if (first) harness.onFirstScroll?.();
			};
			els.set(key, el);
		}
		return el;
	}

	const root = document.createElement('div');
	root.getBoundingClientRect = () => ({ top: 0, bottom: ROOT_BOTTOM }) as DOMRect;
	const owner = stubScrollOwner(stubScrollport({ viewportHeight: ROOT_BOTTOM }), {
		getBlockElByPath: elFor,
		getEditorRoot: () => (opts.withRoot ? root : null)
	});
	// Returned by reference, so a test setting `onFirstScroll` sets the one the scroll reads.
	return Object.assign(harness, { owner });
}

describe('scroll owner: placing', () => {
	it('holds the full target path at the requested block, copied', () => {
		const { owner } = makeOwner();
		const path = [3, 1];
		owner.place(path, { block: 'center', hold: true });
		path[1] = 9;
		expect(owner.heldTarget()).toEqual({ path: [3, 1], block: 'center' });
	});

	it('scrolls the mounted block once to the requested edge and keeps a held nearest target', async () => {
		const h = makeOwner();
		expect(await h.owner.place([4], { block: 'nearest', hold: true }).scroll()).toBe(true);
		expect(h.scrollOpts).toHaveBeenCalledWith({ block: 'nearest' });
		expect(h.owner.heldTarget()).toEqual({ path: [4], block: 'nearest' });
	});

	it('resolves false, never scrolls, and gives up the slot when the block is not mounted', async () => {
		const h = makeOwner({ '[1]': [0] });
		expect(await h.owner.place([99], { block: 'nearest', hold: true }).scroll()).toBe(false);
		expect(h.scrollOpts).not.toHaveBeenCalled();
		// A scroll that failed leaves nothing held to fight the next real scroll.
		expect(h.owner.heldTarget()).toBeNull();
	});

	it.each([
		['an unheld placement', { block: 'nearest', hold: false }],
		['a centred one', { block: 'center', hold: true }]
	] as const)('%s gives the slot back once it resolves', async (_label, opts) => {
		const { owner } = makeOwner();
		expect(await owner.place([4], opts).scroll()).toBe(true);
		expect(owner.heldTarget()).toBeNull();
	});
});

describe('scroll owner: who may drop the slot', () => {
	// Every drop at the end of a scroll checks the placement still holds, so a scroll another one
	// took over cannot take the newer hold with it.
	it.each([
		['a centred placement', { block: 'center', hold: true }],
		['an unheld placement', { block: 'nearest', hold: false }]
	] as const)('%s resolving late leaves a newer placement held', async (_label, opts) => {
		const { owner } = makeOwner();
		const stale = owner.place([4], opts);
		const fresh = owner.place([9], { block: 'nearest', hold: true });
		await stale.scroll();
		await fresh.scroll();
		expect(owner.heldTarget()).toEqual({ path: [9], block: 'nearest' });
	});

	it('a failed placement resolving late leaves a newer placement held', async () => {
		const { owner } = makeOwner({ '[9]': [0] });
		const stale = owner.place([99], { block: 'nearest', hold: true });
		const fresh = owner.place([9], { block: 'nearest', hold: true });
		expect(await stale.scroll()).toBe(false);
		await fresh.scroll();
		expect(owner.heldTarget()?.path).toEqual([9]);
	});

	// Identity, not an equal path: two callers aiming at one block are still two callers.
	it('an older placement on the same path cannot drop the newer one', async () => {
		const { owner } = makeOwner();
		const stale = owner.place([7], { block: 'center', hold: true });
		owner.place([7], { block: 'nearest', hold: true });
		await stale.scroll();
		expect(owner.heldTarget()).toEqual({ path: [7], block: 'nearest' });
	});

	it("the user's release outranks the placement, which cannot take the slot back", async () => {
		const { owner } = makeOwner();
		const pending = owner.place([4], { block: 'nearest', hold: true });
		owner.release();
		await pending.scroll();
		expect(owner.heldTarget()).toBeNull();
		owner.place([8], { block: 'nearest', hold: true });
		await pending.scroll();
		expect(owner.heldTarget()?.path).toEqual([8]);
	});
});

// Why the slot was lost decides whether the follow continues: another scroll owns the viewport,
// while a user release ends only the lasting hold.
describe('scroll owner: the follow, and who may end it', () => {
	it('a superseded placement stops scrolling its own target and reports it out of view', async () => {
		const h = makeOwner({ '[1]': [500, 0], '[2]': [500, 0] }, { withRoot: true });
		const stale = h.owner.place([1], { block: 'nearest', hold: true });
		const fresh = h.owner.place([2], { block: 'nearest', hold: true });

		expect(await stale.scroll()).toBe(false);
		expect(await fresh.scroll()).toBe(true);
		// Zero, not "fewer": the scroll before the loop is also checked, so one taken over during
		// its mount wait never moves the viewport at all.
		expect(h.scrollCount([1])).toBe(0);
		expect(h.scrollCount([2])).toBeGreaterThan(0);
	});

	it('a placement made across an emptied slot still supersedes the one in flight', async () => {
		const h = makeOwner({ '[1]': [500, 0], '[2]': [500, 0] }, { withRoot: true });
		const inFlight = h.owner.place([1], { block: 'nearest', hold: true });
		h.owner.release();
		h.owner.place([2], { block: 'nearest', hold: true });
		expect(await inFlight.scroll()).toBe(false);
		expect(h.scrollCount([1])).toBe(0);
	});

	it('a user release mid-scroll leaves the follow running, so the target still lands in view', async () => {
		// The first scroll lands short (the script holds the target at 500) and the user takes over
		// exactly then; only the follow brings it into view.
		const h = makeOwner({ '[1]': [500, 500, 0] }, { withRoot: true });
		h.onFirstScroll = () => h.owner.release();

		expect(await h.owner.place([1], { block: 'nearest', hold: true }).scroll()).toBe(true);
		expect(h.owner.heldTarget()).toBeNull();
	});
});
