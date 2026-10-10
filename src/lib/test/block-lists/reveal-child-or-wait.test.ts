// @vitest-environment jsdom
// Miss-analysis: the cases asked if the child was in range, never if its element was in the DOM.
import { describe, it, expect, vi } from 'vitest';
import { revealChildOrWait, publishRefSlot, type RefSlots } from '../../block-lists/child-refs';
import { settlesWithin } from '../harness/microtask-settle';

// A windowed block list whose `revealChild` writes a fresh ref one microtask later, as a mount
// after a scroll does.
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

		await revealChildOrWait(0, { slots, childCount: 1, revealChild, isInWindow: () => true });

		expect(revealChild).toHaveBeenCalledWith(0);
		expect(refs[0]).toBeTruthy();
	});

	it('skips reveal when the slot already holds a live ref', async () => {
		const { refs, slots, revealChild } = makeScope();
		refs[0] = {};

		await revealChildOrWait(0, { slots, childCount: 1, revealChild, isInWindow: () => true });

		expect(revealChild).not.toHaveBeenCalled();
	});

	it('drops a ref whose published element left the DOM and re-reveals', async () => {
		const { refs, slots, revealChild } = makeScope();
		const detached = {};
		// A wholesale `replaceRefs` is the real shape: whatever recorded this element is long gone,
		// so no teardown will ever empty the entry.
		publishRefSlot(slots, 0, detached, document.createElement('div'));
		refs[0] = detached;

		await revealChildOrWait(0, { slots, childCount: 1, revealChild, isInWindow: () => true });

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

		await revealChildOrWait(0, { slots, childCount: 1, revealChild, isInWindow: () => true });

		expect(revealChild).not.toHaveBeenCalled();
		expect(refs[0]).toBe(unrecorded);
	});

	it('does not reveal an out-of-doc index (transient size lag never mounts)', async () => {
		const { refs, slots, revealChild } = makeScope();

		// index === count is past the end of the document
		await revealChildOrWait(0, { slots, childCount: 0, revealChild, isInWindow: () => true });

		expect(revealChild).not.toHaveBeenCalled();
		expect(refs[0]).toBeUndefined();
	});

	// A scroll that misses must end the wait rather than hang on a mount that never comes (VR-5).
	// These check that it ends, not where it lands.
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
	});
});
