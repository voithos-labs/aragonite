import { describe, it, expect, vi } from 'vitest';
import {
	revealChildOrWait,
	publishRefSlot,
	type RefSlots
} from '../../reactivity/publish-ref.svelte';

// Racing a fixed microtask budget rather than awaiting `p`: the termination tests
// below would otherwise stall the whole suite on the hang they exist to catch.
async function settlesWithin(p: Promise<unknown>, turns = 50): Promise<boolean> {
	let settled = false;
	void p.then(() => {
		settled = true;
	});
	for (let i = 0; i < turns && !settled; i++) await Promise.resolve();
	return settled;
}

// A windowed scope whose revealChild publishes a fresh ref one microtask later,
// mirroring a row/item mounting after a scroll. A fresh scope per test IS the
// isolation — the mount registry keys on the slots object, not on the index.
function makeScope() {
	const refs: (object | undefined)[] = [];
	const slots: RefSlots<object> = {
		set: (i, r) => {
			refs[i] = r;
		},
		get: (i) => refs[i]
	};
	const revealChild = vi.fn(async (i: number) => {
		await Promise.resolve();
		publishRefSlot(slots, i, {});
	});
	return { refs, slots, revealChild };
}

/** A scope whose child never publishes: the slot reads empty however often it mounts. */
function neverMountsScope(): RefSlots<object> {
	return { set: () => {}, get: () => undefined };
}

describe('revealChildOrWait', () => {
	it('reveals and waits when the slot is empty (in-window mount pending)', async () => {
		const { refs, slots, revealChild } = makeScope();

		await revealChildOrWait(0, { slots, childCount: 1, revealChild });

		expect(revealChild).toHaveBeenCalledWith(0);
		expect(refs[0]).toBeTruthy();
	});

	it('skips reveal when the slot already holds a live ref', async () => {
		const { refs, slots, revealChild } = makeScope();
		refs[0] = {};

		await revealChildOrWait(0, { slots, childCount: 1, revealChild });

		expect(revealChild).not.toHaveBeenCalled();
	});

	it('drops a stale ref and re-reveals when isStale reports the slot off-window', async () => {
		const { refs, slots, revealChild } = makeScope();
		const stale = {};
		refs[0] = stale;

		await revealChildOrWait(0, { slots, childCount: 1, revealChild, isStale: () => true });

		// The stale ref was dropped and a fresh one mounted via revealChild.
		expect(revealChild).toHaveBeenCalledWith(0);
		expect(refs[0]).toBeTruthy();
		expect(refs[0]).not.toBe(stale);
	});

	it('keeps a present ref when isStale reports the slot in-window', async () => {
		const { refs, slots, revealChild } = makeScope();
		const live = {};
		refs[0] = live;

		await revealChildOrWait(0, { slots, childCount: 1, revealChild, isStale: () => false });

		expect(revealChild).not.toHaveBeenCalled();
		expect(refs[0]).toBe(live);
	});

	it('does not reveal an out-of-doc index (transient size lag never mounts)', async () => {
		const { refs, slots, revealChild } = makeScope();

		// index === count → out of doc
		await revealChildOrWait(0, { slots, childCount: 0, revealChild });

		expect(revealChild).not.toHaveBeenCalled();
		expect(refs[0]).toBeUndefined();
	});

	// VR-5: the loop is woken ONLY by a same-scope, same-index mount, so a scroll that
	// misses would hang forever. These assert termination, not placement.
	describe('terminates instead of hanging when the reveal misses (VR-5)', () => {
		it('resolves without mounting when the recomputed window excludes the target', async () => {
			// A stale model at call time: the slot stays empty and the target is reported
			// outside the recomputed window.
			const revealChild = vi.fn(async () => {
				await Promise.resolve();
			});

			const call = revealChildOrWait(0, {
				slots: neverMountsScope(),
				childCount: 1,
				revealChild,
				isInWindow: () => false
			});

			// Nothing ever wakes the registry for this scope, so settling at all proves the
			// membership short-circuit returned before the mount-wait loop.
			expect(await settlesWithin(call)).toBe(true);
			expect(revealChild).toHaveBeenCalledWith(0);
		});

		it('degrades when an in-window target never publishes (failed-render boundary)', async () => {
			// In-window but rendering its failed boundary, so bind:this never assigns and
			// no same-index mount will ever fire.
			const revealChild = vi.fn(async () => {
				await Promise.resolve();
			});

			const call = revealChildOrWait(0, {
				slots: neverMountsScope(),
				childCount: 1,
				revealChild,
				isInWindow: () => true
			});

			expect(await settlesWithin(call)).toBe(true);
			expect(revealChild).toHaveBeenCalledWith(0);
		});

		it('degrades when a non-windowing target never mounts and no wake ever fires', async () => {
			// Neither membership nor a wake can end this one, so only the tick-bounded loop
			// does. The raised settle budget covers its full re-wait cap.
			const revealChild = vi.fn(async () => {
				await Promise.resolve();
			});

			const call = revealChildOrWait(0, {
				slots: neverMountsScope(),
				childCount: 1,
				revealChild
			});

			expect(await settlesWithin(call, 300)).toBe(true);
			expect(revealChild).toHaveBeenCalledWith(0);
		});

		it('still terminates when this scope mounts and unpublishes in the same flush', async () => {
			// The residual spurious wake under per-scope keying: a real mount at this index
			// that clears again before the waiter re-reads. Only the per-wake cap stops it.
			const { slots, refs, revealChild } = makeScope();
			const call = revealChildOrWait(0, { slots, childCount: 1, revealChild });

			for (let pump = 0; pump < 500; pump++) {
				await Promise.resolve();
				publishRefSlot(slots, 0, {});
				refs[0] = undefined;
			}

			expect(await settlesWithin(call)).toBe(true);
		});
	});
});
