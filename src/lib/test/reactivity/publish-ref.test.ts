import { describe, it, expect } from 'vitest';
import { publishRefSlot, whenRefMounted, type RefSlots } from '../../reactivity/publish-ref.svelte';
import { settlesWithin } from '../harness/microtask-settle';

// One scope: the editor's blockRefs slots behind the accessors it publishes through.
// A fresh pair per test IS the isolation — the registry keys on this object, so no
// leftover waiter from another test or scope can reach into this one.
function makeSlots(): RefSlots<object> & { refs: (object | undefined)[] } {
	const refs: (object | undefined)[] = [];
	return {
		refs,
		set: (i, r) => {
			refs[i] = r;
		},
		get: (i) => refs[i]
	};
}

describe('mount-await registry', () => {
	it('resolves a pending wait when the ref slot is later published', async () => {
		const slots = makeSlots();

		const wait = whenRefMounted(slots, 0);
		expect(await settlesWithin(wait)).toBe(false);

		publishRefSlot(slots, 0, {});
		await expect(wait).resolves.toBeUndefined();
	});

	it('resolves immediately when the slot is already filled', async () => {
		const slots = makeSlots();
		slots.set(0, {});

		expect(await settlesWithin(whenRefMounted(slots, 0))).toBe(true);
	});

	it('does not resolve a waiter when an undefined ref is published', async () => {
		const slots = makeSlots();

		const wait = whenRefMounted(slots, 0);
		publishRefSlot(slots, 0, undefined);
		expect(await settlesWithin(wait)).toBe(false);

		// A real mount afterward still wakes it.
		publishRefSlot(slots, 0, {});
		await expect(wait).resolves.toBeUndefined();
	});

	it('wakes every waiter registered on the same index', async () => {
		const slots = makeSlots();

		const waits = [whenRefMounted(slots, 0), whenRefMounted(slots, 0)];
		expect(await settlesWithin(Promise.all(waits))).toBe(false);

		publishRefSlot(slots, 0, {});
		await expect(Promise.all(waits)).resolves.toEqual([undefined, undefined]);
	});

	it('does not wake a waiter on a different index', async () => {
		const slots = makeSlots();

		const wait = whenRefMounted(slots, 0);
		publishRefSlot(slots, 1, {});
		expect(await settlesWithin(wait)).toBe(false);
	});

	// The multi-instance / nesting collision: a bare-index registry woke both.
	it('does not wake a waiter when another scope publishes at the same index', async () => {
		const mine = makeSlots();
		const foreign = makeSlots();

		const wait = whenRefMounted(mine, 0);
		publishRefSlot(foreign, 0, {});

		expect(await settlesWithin(wait)).toBe(false);
	});

	it('wakes each scope from its own publish when both wait on the same index', async () => {
		const first = makeSlots();
		const second = makeSlots();
		const firstWait = whenRefMounted(first, 0);
		const secondWait = whenRefMounted(second, 0);

		publishRefSlot(second, 0, {});
		expect(await settlesWithin(secondWait)).toBe(true);
		expect(await settlesWithin(firstWait)).toBe(false);

		publishRefSlot(first, 0, {});
		await expect(firstWait).resolves.toBeUndefined();
	});
});
