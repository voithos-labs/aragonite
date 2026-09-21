// @vitest-environment jsdom
// Miss-analysis: the cases below asked whether the child was in the mounted range, so the
// false positive they encoded (a mounted child cleared because the range lagged by one flush,
// and never written again) read as deliberate; none asked whether the ref's element was still
// in the DOM.
import { describe, it, expect, vi } from 'vitest';
import {
	revealChildOrWait,
	publishRefSlot,
	type RefSlots
} from '../../reactivity/publish-ref.svelte';
import { settlesWithin } from '../harness/microtask-settle';

// A windowed block list whose `revealChild` writes a fresh ref one microtask later, the way a
// row or item mounts after a scroll. A fresh list per test is what isolates them, since the
// mount registry keys on the entries object, not on the index.
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

/** A list whose child never writes its ref: the entry reads empty however often it mounts. */
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

	it('drops a ref whose published element left the DOM and re-reveals', async () => {
		const { refs, slots, revealChild } = makeScope();
		const detached = {};
		// A wholesale `replaceRefs` is the real shape: whatever recorded this element is long gone,
		// so no teardown will ever empty the entry.
		publishRefSlot(slots, 0, detached, document.createElement('div'));
		refs[0] = detached;

		await revealChildOrWait(0, { slots, childCount: 1, revealChild });

		expect(revealChild).toHaveBeenCalledWith(0);
		expect(refs[0]).toBeTruthy();
		expect(refs[0]).not.toBe(detached);
	});

	it('keeps a mounted ref the window reports off-slice (the one-flush skew)', async () => {
		const { refs, slots, revealChild } = makeScope();
		const mounted = {};
		const el = document.createElement('div');
		document.body.append(el);
		publishRefSlot(slots, 0, mounted, el);

		// A scripted scroll moves the range a flush before the DOM follows. Clearing here strands
		// the ref, since nothing writes it again for a mount that never changed.
		await revealChildOrWait(0, { slots, childCount: 1, revealChild, isInWindow: () => false });

		expect(revealChild).not.toHaveBeenCalled();
		expect(refs[0]).toBe(mounted);
		el.remove();
	});

	it('keeps a ref no publisher recorded an element for (degrades to live)', async () => {
		const { refs, slots, revealChild } = makeScope();
		const unrecorded = {};
		refs[0] = unrecorded;

		await revealChildOrWait(0, { slots, childCount: 1, revealChild });

		expect(revealChild).not.toHaveBeenCalled();
		expect(refs[0]).toBe(unrecorded);
	});

	it('does not reveal an out-of-doc index (transient size lag never mounts)', async () => {
		const { refs, slots, revealChild } = makeScope();

		// index === count is past the end of the document
		await revealChildOrWait(0, { slots, childCount: 0, revealChild });

		expect(revealChild).not.toHaveBeenCalled();
		expect(refs[0]).toBeUndefined();
	});

	// VR-5: the loop is woken only by a mount in the same list at the same index, so a scroll
	// that misses would hang forever. These check that it ends, not where it lands.
	describe('terminates instead of hanging when the reveal misses (VR-5)', () => {
		it('resolves without mounting when the recomputed window excludes the target', async () => {
			// A stale height table when it is called: the entry stays empty and the target is
			// reported outside the recomputed range.
			const revealChild = vi.fn(async () => {
				await Promise.resolve();
			});

			const call = revealChildOrWait(0, {
				slots: neverMountsScope(),
				childCount: 1,
				revealChild,
				isInWindow: () => false
			});

			// Nothing ever wakes the registry for this list, so finishing at all proves the range
			// check returned before the loop that waits for a mount.
			expect(await settlesWithin(call)).toBe(true);
			expect(revealChild).toHaveBeenCalledWith(0);
		});

		it('degrades when an in-window target never publishes (failed-render boundary)', async () => {
			// Inside the range but rendering its failure fallback, so `bind:this` never assigns and
			// no mount at that index will ever fire.
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
			// Neither the range check nor a wake can end this one, so only the loop bounded by ticks
			// does. The raised budget covers its full retry cap.
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
			// The one spurious wake left once the registry keys per list: a real mount at this index
			// that clears again before the waiter reads it. Only the cap on retries stops it.
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
