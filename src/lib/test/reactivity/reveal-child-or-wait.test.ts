import { describe, it, expect, vi } from 'vitest';
import { revealChildOrWait, publishRefSlot } from '../../reactivity/publish-ref.svelte';

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
});
