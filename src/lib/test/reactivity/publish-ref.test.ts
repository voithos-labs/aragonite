import { describe, it, expect } from 'vitest';
import { publishRefSlot, whenRefMounted } from '../../reactivity/publish-ref.svelte';

// Distinguishes "resolved through the registry" from "still waiting on a mount".
// Microtask drains only, no wall-clock timer (Design Rule #2 / G4.4).
async function isSettled(p: Promise<unknown>): Promise<boolean> {
	let settled = false;
	void p.then(() => {
		settled = true;
	});
	for (let i = 0; i < 5; i++) await Promise.resolve();
	return settled;
}

// Mirrors the editor's blockRefs slots behind publishRefSlot's setRef/getRef.
function makeSlots() {
	const refs: (object | undefined)[] = [];
	return {
		refs,
		setRef: (i: number, r: object | undefined) => {
			refs[i] = r;
		},
		getRef: (i: number) => refs[i]
	};
}

// Module-level mountWaiters is shared; each test uses a distinct index so a
// leftover waiter from another test can't resolve this one.
let nextIndex = 1000;
const freshIndex = () => nextIndex++;

describe('mount-await registry', () => {
	it('resolves a pending wait when the ref slot is later published', async () => {
		const i = freshIndex();
		const { setRef, getRef } = makeSlots();

		const wait = whenRefMounted(i, () => false);
		expect(await isSettled(wait)).toBe(false);

		publishRefSlot(i, {}, setRef, getRef);
		await expect(wait).resolves.toBeUndefined();
	});

	it('resolves immediately when the slot is already present (isPresent-first)', async () => {
		const i = freshIndex();
		const wait = whenRefMounted(i, () => true);
		expect(await isSettled(wait)).toBe(true);
	});

	it('does not resolve a waiter when an undefined ref is published', async () => {
		const i = freshIndex();
		const { setRef, getRef } = makeSlots();

		const wait = whenRefMounted(i, () => false);
		publishRefSlot(i, undefined, setRef, getRef);
		expect(await isSettled(wait)).toBe(false);

		// A real mount afterward still wakes it.
		publishRefSlot(i, {}, setRef, getRef);
		await expect(wait).resolves.toBeUndefined();
	});

	it('wakes every waiter registered on the same index', async () => {
		const i = freshIndex();
		const { setRef, getRef } = makeSlots();

		const waits = [whenRefMounted(i, () => false), whenRefMounted(i, () => false)];
		expect(await isSettled(Promise.all(waits))).toBe(false);

		publishRefSlot(i, {}, setRef, getRef);
		await expect(Promise.all(waits)).resolves.toEqual([undefined, undefined]);
	});

	it('does not wake a waiter on a different index', async () => {
		const target = freshIndex();
		const other = freshIndex();
		const { setRef, getRef } = makeSlots();

		const wait = whenRefMounted(target, () => false);
		publishRefSlot(other, {}, setRef, getRef);
		expect(await isSettled(wait)).toBe(false);
	});
});
