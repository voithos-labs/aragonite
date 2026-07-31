import { describe, it, expect, vi } from 'vitest';
import { revealChildOrWait, publishRefSlot } from '../../reactivity/publish-ref.svelte';

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

// Module-level mountWaiters is shared; each test uses a distinct index so a
// leftover waiter from another test can't resolve this one.
let nextIndex = 5000;
const freshIndex = () => nextIndex++;

// A windowed scope whose revealChild publishes a fresh ref one microtask later,
// mirroring a row/item mounting after a scroll.
function makeScope() {
	const refs: (object | undefined)[] = [];
	const revealChild = vi.fn(async (i: number) => {
		await Promise.resolve();
		publishRefSlot(
			i,
			{},
			(j, r) => {
				refs[j] = r;
			},
			(j) => refs[j]
		);
	});
	return { refs, revealChild };
}

describe('revealChildOrWait', () => {
	it('reveals and waits when the slot is empty (in-window mount pending)', async () => {
		const i = freshIndex();
		const { refs, revealChild } = makeScope();

		await revealChildOrWait(i, {
			childCount: i + 1,
			getRef: (j) => refs[j],
			revealChild
		});

		expect(revealChild).toHaveBeenCalledWith(i);
		expect(refs[i]).toBeTruthy();
	});

	it('skips reveal when the slot already holds a live ref', async () => {
		const i = freshIndex();
		const { refs, revealChild } = makeScope();
		refs[i] = {};

		await revealChildOrWait(i, {
			childCount: i + 1,
			getRef: (j) => refs[j],
			revealChild
		});

		expect(revealChild).not.toHaveBeenCalled();
	});

	it('drops a stale ref and re-reveals when isStale reports the slot off-window', async () => {
		const i = freshIndex();
		const { refs, revealChild } = makeScope();
		const stale = {};
		refs[i] = stale;

		await revealChildOrWait(i, {
			childCount: i + 1,
			getRef: (j) => refs[j],
			dropRef: (j) => {
				refs[j] = undefined;
			},
			revealChild,
			isStale: () => true
		});

		// The stale ref was dropped and a fresh one mounted via revealChild.
		expect(revealChild).toHaveBeenCalledWith(i);
		expect(refs[i]).toBeTruthy();
		expect(refs[i]).not.toBe(stale);
	});

	it('keeps a present ref when isStale reports the slot in-window', async () => {
		const i = freshIndex();
		const { refs, revealChild } = makeScope();
		const live = {};
		refs[i] = live;

		await revealChildOrWait(i, {
			childCount: i + 1,
			getRef: (j) => refs[j],
			dropRef: (j) => {
				refs[j] = undefined;
			},
			revealChild,
			isStale: () => false
		});

		expect(revealChild).not.toHaveBeenCalled();
		expect(refs[i]).toBe(live);
	});

	it('does not reveal an out-of-doc index (transient size lag never mounts)', async () => {
		const i = freshIndex();
		const { refs, revealChild } = makeScope();

		await revealChildOrWait(i, {
			childCount: i, // index === count → out of doc
			getRef: (j) => refs[j],
			revealChild
		});

		expect(revealChild).not.toHaveBeenCalled();
		expect(refs[i]).toBeUndefined();
	});

	// VR-5: the loop is woken ONLY by a same-index mount, so a scroll that misses would
	// hang forever. These assert termination, not placement.
	describe('terminates instead of hanging when the reveal misses (VR-5)', () => {
		it('resolves without mounting when the recomputed window excludes the target', async () => {
			const i = freshIndex();
			// A stale model at call time: the slot stays empty and the target is reported
			// outside the recomputed window.
			const revealChild = vi.fn(async () => {
				await Promise.resolve();
			});

			const call = revealChildOrWait(i, {
				childCount: i + 1,
				getRef: () => undefined,
				revealChild,
				isInWindow: () => false
			});

			// Nothing ever wakes the registry for index i, so settling at all proves the
			// membership short-circuit returned before the mount-wait loop.
			expect(await settlesWithin(call)).toBe(true);
			expect(revealChild).toHaveBeenCalledWith(i);
		});

		it('degrades when an in-window target never publishes (failed-render boundary)', async () => {
			const i = freshIndex();
			// In-window but rendering its failed boundary, so bind:this never assigns and
			// no same-index mount will ever fire.
			const revealChild = vi.fn(async () => {
				await Promise.resolve();
			});

			const call = revealChildOrWait(i, {
				childCount: i + 1,
				getRef: () => undefined,
				revealChild,
				isInWindow: () => true
			});

			expect(await settlesWithin(call)).toBe(true);
			expect(revealChild).toHaveBeenCalledWith(i);
		});

		it('degrades when a non-windowing target never mounts and no wake ever fires', async () => {
			const i = freshIndex();
			// Neither membership nor a wake can end this one, so only the tick-bounded loop
			// does. The raised settle budget covers its full re-wait cap.
			const revealChild = vi.fn(async () => {
				await Promise.resolve();
			});

			const call = revealChildOrWait(i, {
				childCount: i + 1,
				getRef: () => undefined,
				revealChild
			});

			expect(await settlesWithin(call, 300)).toBe(true);
			expect(revealChild).toHaveBeenCalledWith(i);
		});

		it('still terminates under a storm of spurious same-index wakes (re-wait cap)', async () => {
			const i = freshIndex();
			// Membership is unknown, so the call enters the mount-wait loop and a foreign
			// scope mounting at the same local index re-checks it forever unless the
			// per-wake cap stops the storm.
			const revealChild = vi.fn(async () => {
				await Promise.resolve();
			});

			const call = revealChildOrWait(i, {
				childCount: i + 1,
				getRef: () => undefined, // this scope's slot never fills
				revealChild
			});

			// Publishing into a SEPARATE refs array resolves the shared waiter without ever
			// populating this scope's getRef — which is what makes the wake spurious.
			const foreignRefs: (object | undefined)[] = [];
			for (let pump = 0; pump < 500; pump++) {
				await Promise.resolve();
				publishRefSlot(
					i,
					{},
					(j, r) => {
						foreignRefs[j] = r;
					},
					(j) => foreignRefs[j]
				);
				foreignRefs[i] = undefined; // reset so the next pump re-wakes
			}

			expect(await settlesWithin(call)).toBe(true);
		});
	});
});
