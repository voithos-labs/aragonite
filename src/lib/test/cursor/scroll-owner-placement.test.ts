// @vitest-environment jsdom
// A scroll into view takes the one placement slot before its mount and scrolls after. Who holds
// the slot, and who may drop it, decides whether an older scroll can undo a newer one's hold.
import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { takeDevWarns } from '../support/warn-gate';
import { stubScrollOwner, stubScrollport } from '../harness/stub-scrollport';

const ROOT_BOTTOM = 100;
const EL_HEIGHT = 20;
// Where the height table puts every target, far from any scroll position a test writes.
const TABLE_TOP = 1000;

/** An owner over blocks whose top follows a script per path: [initialTop, ...topAfterEachScroll].
 *  With `withRoot` false there is no editor root, so a mounted target counts as landed. */
function makeOwner(scripts: Record<string, number[]> = {}, opts: { withRoot?: boolean } = {}) {
	const scrolls: string[] = [];
	const els = new Map<string, HTMLElement>();
	const asked: number[][] = [];
	const harness = {
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
				scrolls.push(key);
				harness.scrollOpts(o as ScrollIntoViewOptions);
				if (at.rest.length) at.top = at.rest.shift()!;
			};
			els.set(key, el);
		}
		return el;
	}

	const root = document.createElement('div');
	root.getBoundingClientRect = () => ({ top: 0, bottom: ROOT_BOTTOM }) as DOMRect;
	const port = stubScrollport({ viewportHeight: ROOT_BOTTOM });
	const owner = stubScrollOwner(port, {
		getBlockElByPath: elFor,
		getEditorRoot: () => (opts.withRoot ? root : null)
	});
	owner.resolveTargetsWith({
		resolve: (path) => {
			asked.push([...path]);
			return { top: TABLE_TOP, height: EL_HEIGHT };
		},
		syncScrollTop: () => {}
	});

	/** The path the owner keeps in place across the next height change, or null for none. */
	function heldPath(): number[] | null {
		asked.length = 0;
		owner.compensate(
			'root-list',
			() => {},
			() => 0
		);
		return asked[0] ?? null;
	}

	return Object.assign(harness, { owner, port, heldPath });
}

describe('scroll owner: placing', () => {
	it('holds the full target path, copied, before the scroll runs', () => {
		const h = makeOwner();
		const path = [3, 1];
		h.owner.place(path, { block: 'nearest', hold: true });
		path[1] = 9;
		expect(h.heldPath()).toEqual([3, 1]);
	});

	it.each([
		['nearest', TABLE_TOP],
		['center', TABLE_TOP - (ROOT_BOTTOM - EL_HEIGHT) / 2]
	] as const)(
		'before the scroll records a landing, a %s placement goes where the height table says',
		(block, expected) => {
			const h = makeOwner();
			h.owner.place([4], { block, hold: true });
			h.heldPath();
			expect(h.port.scrollTop()).toBe(expected);
		}
	);

	it('scrolls the mounted block once to the requested edge and keeps a held nearest target', async () => {
		const h = makeOwner();
		expect(await h.owner.place([4], { block: 'nearest', hold: true }).scroll()).toBe(true);
		expect(h.scrollOpts).toHaveBeenCalledOnce();
		expect(h.scrollOpts).toHaveBeenCalledWith({ block: 'nearest' });
		expect(h.heldPath()).toEqual([4]);
	});

	it('resolves false, never scrolls, and gives up the slot when the block is not mounted', async () => {
		const h = makeOwner({ '[1]': [0] });
		expect(await h.owner.place([99], { block: 'nearest', hold: true }).scroll()).toBe(false);
		expect(h.scrollOpts).not.toHaveBeenCalled();
		// A scroll that failed leaves nothing held to fight the next real scroll.
		expect(h.heldPath()).toBeNull();
	});

	it.each([
		['an unheld placement', { block: 'nearest', hold: false }],
		['a centred one', { block: 'center', hold: true }]
	] as const)('%s gives the slot back once it resolves', async (_label, opts) => {
		const h = makeOwner();
		expect(await h.owner.place([4], opts).scroll()).toBe(true);
		expect(h.heldPath()).toBeNull();
	});
});

// Miss-analysis: a held `'nearest'` target was re-placed at the viewport's top on every height
// change, and every test of the hold placed its target at the top already, so none could see it.
describe('scroll owner: a held target stays where it landed', () => {
	it('re-places at the offset the scroll left it, whatever the height table says', async () => {
		// Mounted 60px below the viewport's top with the scroll at 40, so its content top is 100.
		const h = makeOwner({ '[4]': [60] });
		h.port.setScrollTop(40);
		await h.owner.place([4], { block: 'nearest', hold: true }).scroll();
		// The table put it at 1000, so the recorded bias carries the 900 it doesn't know about.
		h.heldPath();
		expect(h.port.scrollTop()).toBe(40);
	});
});

describe('scroll owner: when a placement is done', () => {
	/** How many flushes the test sees before an unheld placement resolves, with a compensation
	 *  run in each of the first `busy` flushes. */
	async function flushesUntilDone(busy: number): Promise<number> {
		const h = makeOwner();
		let done = false;
		void h.owner
			.place([4], { block: 'nearest', hold: false })
			.scroll()
			.then(() => (done = true));
		let flushes = 0;
		while (!done) {
			if (flushes < busy) h.heldPath();
			await tick();
			flushes++;
		}
		return flushes;
	}

	it('ends at the first flush with no compensation in it', async () => {
		const quiet = await flushesUntilDone(0);
		// The test reads the result one flush after the owner returns.
		expect(quiet).toBe(2);
		expect(await flushesUntilDone(3)).toBe(quiet + 3);
	});

	it('waits out the height changes that follow, and warns when they never stop', async () => {
		const h = makeOwner();
		let running = true;
		const flushes = { count: 0 };
		// A compensation in every flush: what a mount wave that never goes quiet looks like.
		const keepCompensating = async () => {
			while (running) {
				h.heldPath();
				flushes.count++;
				await Promise.resolve();
			}
		};
		void keepCompensating();
		await h.owner.place([4], { block: 'nearest', hold: false }).scroll();
		running = false;
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['scroll']);
		expect(flushes.count).toBeGreaterThan(12);
	});
});

describe('scroll owner: who may drop the slot', () => {
	// Every drop at the end of a scroll checks the placement still holds, so a scroll another one
	// took over cannot take the newer hold with it.
	it.each([
		['a centred placement', { block: 'center', hold: true }],
		['an unheld placement', { block: 'nearest', hold: false }]
	] as const)('%s resolving late leaves a newer placement held', async (_label, opts) => {
		const h = makeOwner();
		const stale = h.owner.place([4], opts);
		const fresh = h.owner.place([9], { block: 'nearest', hold: true });
		await stale.scroll();
		await fresh.scroll();
		expect(h.heldPath()).toEqual([9]);
	});

	it('a failed placement resolving late leaves a newer placement held', async () => {
		const h = makeOwner({ '[9]': [0] });
		const stale = h.owner.place([99], { block: 'nearest', hold: true });
		const fresh = h.owner.place([9], { block: 'nearest', hold: true });
		expect(await stale.scroll()).toBe(false);
		await fresh.scroll();
		expect(h.heldPath()).toEqual([9]);
	});

	// Identity, not an equal path: two callers aiming at one block are still two callers.
	it('an older placement on the same path cannot drop the newer one', async () => {
		const h = makeOwner();
		const stale = h.owner.place([7], { block: 'center', hold: true });
		h.owner.place([7], { block: 'nearest', hold: true });
		await stale.scroll();
		expect(h.heldPath()).toEqual([7]);
	});

	it("the user's release outranks the placement, which cannot take the slot back", async () => {
		const h = makeOwner();
		const pending = h.owner.place([4], { block: 'nearest', hold: true });
		h.owner.release();
		await pending.scroll();
		expect(h.heldPath()).toBeNull();
		h.owner.place([8], { block: 'nearest', hold: true });
		await pending.scroll();
		expect(h.heldPath()).toEqual([8]);
	});
});

describe('scroll owner: a superseded placement', () => {
	it('never scrolls its own target and reports it out of view', async () => {
		const h = makeOwner({ '[1]': [500, 0], '[2]': [500, 0] }, { withRoot: true });
		const stale = h.owner.place([1], { block: 'nearest', hold: true });
		const fresh = h.owner.place([2], { block: 'nearest', hold: true });

		expect(await stale.scroll()).toBe(false);
		expect(await fresh.scroll()).toBe(true);
		// Zero, not "fewer": one taken over during its mount wait never moves the viewport at all.
		expect(h.scrollCount([1])).toBe(0);
		expect(h.scrollCount([2])).toBe(1);
	});

	it('a placement made across an emptied slot still supersedes the one in flight', async () => {
		const h = makeOwner({ '[1]': [500, 0], '[2]': [500, 0] }, { withRoot: true });
		const inFlight = h.owner.place([1], { block: 'nearest', hold: true });
		h.owner.release();
		h.owner.place([2], { block: 'nearest', hold: true });
		expect(await inFlight.scroll()).toBe(false);
		expect(h.scrollCount([1])).toBe(0);
	});
});
