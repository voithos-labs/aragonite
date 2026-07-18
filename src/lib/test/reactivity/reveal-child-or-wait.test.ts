import { describe, it, expect, vi } from 'vitest';
import { revealChildOrWait, publishRefSlot } from '../../reactivity/publish-ref.svelte';

// Resolves true if `p` settles within a bounded number of microtask turns, false
// otherwise. The termination tests below assert a reveal whose target never mounts
// RESOLVES rather than hanging; an unbounded wait would leave `p` pending forever, so
// the race against a fixed microtask budget reads false — a hang would FAIL the test
// (and the suite would not stall, since this returns either way).
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

// A windowed scope: a slot array plus a revealChild that, on the next microtask,
// publishes a fresh ref into the target slot (mirrors a row/item mounting after a
// scroll). Tracks whether revealChild ran.
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

	// VR-5: the loop is woken ONLY by a same-index mount, so a scroll that misses
	// (stale model → target stays outside the recomputed window) would otherwise hang
	// forever. These assert TERMINATION: the call must settle even when the target
	// never mounts.
	describe('terminates instead of hanging when the reveal misses (VR-5)', () => {
		it('resolves without mounting when the recomputed window excludes the target', async () => {
			const i = freshIndex();
			// A scroll that does NOT mount the target (the model was stale at call time):
			// the slot stays empty and isInWindow reports the target outside [start,end).
			const revealChild = vi.fn(async () => {
				await Promise.resolve();
			});

			const call = revealChildOrWait(i, {
				childCount: i + 1,
				getRef: () => undefined,
				revealChild,
				isInWindow: () => false
			});

			// The mount registry is never woken for index i, so an unbounded wait would
			// leave this pending forever. The membership short-circuit returns instead.
			expect(await settlesWithin(call)).toBe(true);
			expect(revealChild).toHaveBeenCalledWith(i);
			// No spurious wake was fired, yet it still terminated — proving it never
			// entered the mount-wait loop (which only this never-firing registry could wake).
		});

		it('degrades when an in-window target never publishes (failed-render boundary)', async () => {
			const i = freshIndex();
			// The child IS mounted (in-window) but renders its failed boundary, so
			// bind:this never assigns and no same-index mount will ever fire. The
			// reveal must return so the caller degrades, not park forever.
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
			// A non-windowing caller (isInWindow omitted) whose target never publishes —
			// a failed-render boundary leaves bind:this unset — AND whose shared registry
			// is never woken (no foreign-scope mount). The open-ended event wait would hang
			// forever; the tick-bounded loop degrades. A larger settle budget than the
			// default accommodates the full re-wait cap of tick-length waits.
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
			// Membership is unknown to this scope (isInWindow omitted), so the call enters
			// the bounded mount-wait loop. THIS scope's slot never fills; instead a flood of
			// spurious wakes — a DIFFERENT scope mounting a child at the same local index i —
			// fires the shared registry and re-checks this scope (still empty). The per-wake
			// cap must stop the loop rather than re-waiting forever on the storm.
			const revealChild = vi.fn(async () => {
				await Promise.resolve();
			});

			const call = revealChildOrWait(i, {
				childCount: i + 1,
				getRef: () => undefined, // this scope's slot never fills
				revealChild
			});

			// Each turn yields to the loop's await, then a foreign-scope mount at the same
			// index wakes it. publishRefSlot into a SEPARATE refs array (a different scope)
			// resolves the shared waiter without ever populating this scope's getRef.
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
