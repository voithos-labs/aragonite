import { tick, untrack } from 'svelte';

/**
 * One block list's array of child-component refs, reached only through the accessors its
 * owner creates. The object's identity is what the list is known by: the mount registry keys
 * on it, so a mount in one list cannot wake a waiter in another (a nested level, a sibling
 * container, a second editor). Neither accessor is reactive, since the array underneath is
 * plain, so a `get` creates no dependency and a `set` wakes no effect; use `whenRefMounted`.
 */
export interface RefSlots<T> {
	set(index: number, ref: T | undefined): void;
	get(index: number): T | undefined;
}

/** Builds the accessors over a list's ref array. Takes the array itself, not a getter, so it
 *  cannot be re-aimed at a replacement: Svelte holds a teardown's reads to pre-flush values, so
 *  a swapped array takes each cleanup's clear with it and leaves the dead ref in the live one.
 *  Write a whole new set of contents with `replaceRefs`. */
export function refSlotsOver<T>(refs: (T | undefined)[]): RefSlots<T> {
	return {
		set: (index, ref) => {
			refs[index] = ref;
		},
		get: (index) => refs[index]
	};
}

/** Writes a whole array of refs in place, the only supported way to replace a list's
 *  contents at once (see `refSlotsOver` for why the array's identity matters). */
export function replaceRefs<T>(
	target: (T | undefined)[],
	values: readonly (T | undefined)[]
): void {
	target.length = values.length;
	for (let i = 0; i < values.length; i++) target[i] = values[i];
}

/**
 * Replaces `bind:this={refs[i]}` in a keyed each: Svelte 5's `bind:this` does not re-target
 * when the iteration index shifts. The cleanup is conditional because the order of effect
 * cleanups across siblings is not guaranteed, and clearing unconditionally would overwrite a
 * neighbour's entry. `el` is the ref's own box, which is what lets `isSlotDetached` answer.
 */
export function publishRefSlot<T>(
	slots: RefSlots<T>,
	index: number,
	ref: T | undefined,
	el?: Element | null
): () => void {
	slots.set(index, ref);
	if (el && typeof ref === 'object' && ref !== null) publishedElements.set(ref, el);
	// The cleanup compares against what the entry actually holds, not the ref passed in;
	// untracked, since writers run inside effects and would invalidate themselves.
	const publishedRef = untrack(() => slots.get(index));
	if (publishedRef !== undefined) resolveMountWaiters(slots, index);
	return () => {
		if (slots.get(index) === publishedRef) {
			slots.set(index, undefined);
		}
	};
}

// ── Mount attachment ─────────────────────────────────────────────────────────

// Keyed on the ref's identity, not on (slots, index): a wholesale `replaceRefs` moves a
// saved ref that no writer will run for again, and only the ref itself still knows its box.
// Weak, so the entry dies with the ref rather than outliving the list.
const publishedElements = new WeakMap<object, Element>();

/**
 * True when the entry's ref is a mount that already left the DOM. The one place this is
 * answered, and it asks whether the element is still in the DOM, never whether the block is in
 * the mounted range: a scripted scroll moves the range a flush before the DOM follows, so
 * treating "outside the range" as dead would clear refs whose components are still mounted and
 * which nothing writes again. A ref with no recorded box counts as live.
 */
function isSlotDetached<T>(slots: RefSlots<T>, index: number): boolean {
	const ref = slots.get(index);
	if (typeof ref !== 'object' || ref === null) return false;
	const el = publishedElements.get(ref);
	return el !== undefined && !el.isConnected;
}

// ── Scroll a child in and wait for it ────────────────────────────────────────

export interface RevealChildOptions<T> {
	/** This list's ref entries: what the wait reads and clears, and what it keys the wait on. */
	readonly slots: RefSlots<T>;
	/** This list's child count; an index at or past it can never mount. */
	readonly childCount: number;
	/** Scroll this list so child `index` is in the mounted range; resolves after a tick. */
	readonly revealChild: (index: number) => Promise<void>;
	/** True when `index` is inside the list's current mounted range, read after `revealChild`
	 *  resolved, which is what makes the wait terminate (VR-5). Optional only for a list that
	 *  does not window: every real caller supplies it, so the bounded retry below is the test
	 *  harness's fallback, not a live path. */
	readonly isInWindow?: (index: number) => boolean;
}

/** Each wait races a tick, so a list that cannot say whether the child is in range would
 *  spin forever on a child that never mounts. This bounds those turns. */
const MAX_MOUNT_REWAITS = 64;

/**
 * Bring child `index` into the mounted range before a caller reads its ref: drop a ref that
 * left the DOM, scroll the child in, and await its mount. Shared by the standard container path
 * and TableBlock's own, so "is this entry a live mount" is decided in one place. It terminates
 * (VR-5) because only a mount at this index in this list wakes the wait: a windowing caller
 * checks the range first, and one that does not window races each wait against a tick.
 */
export async function revealChildOrWait<T>(
	index: number,
	opts: RevealChildOptions<T>
): Promise<void> {
	const detached = isSlotDetached(opts.slots, index);
	if (index >= opts.childCount || (!detached && opts.slots.get(index))) return;
	if (detached) opts.slots.set(index, undefined);
	await opts.revealChild(index);
	if (opts.slots.get(index)) return;
	if (opts.isInWindow) {
		// Outside the recomputed range, so the mount cannot fire; give up now.
		if (!opts.isInWindow(index)) return;
		// Inside the range, the mount flush is at most one tick away; an entry still empty after
		// it means a failed render left `bind:this` unset, which wakes no waiter.
		await tick();
		return;
	}
	// The range is unknown here: wait for the mount a bounded number of times, each raced
	// against a tick, so a child that never mounts gives up at the cap instead of waiting forever.
	let rewaits = 0;
	while (!opts.slots.get(index) && rewaits++ < MAX_MOUNT_REWAITS) {
		await Promise.race([whenRefMounted(opts.slots, index), tick()]);
	}
}

// ── Mount-await registry ─────────────────────────────────────────────────────

const mountWaiters = new WeakMap<object, Map<number, Array<() => void>>>();

/**
 * Resolve when entry `index` of `slots` is, or becomes, filled. Woken by `publishRefSlot` on
 * a real mount, never by a timer (Design Rule #2, G4.4). A wake can still be spurious within
 * one list: a mount that clears its entry in the same flush leaves it empty, so the caller
 * checks again.
 */
export function whenRefMounted<T>(slots: RefSlots<T>, index: number): Promise<void> {
	if (slots.get(index) !== undefined) return Promise.resolve();
	return new Promise((resolve) => {
		let byIndex = mountWaiters.get(slots);
		if (!byIndex) {
			byIndex = new Map();
			mountWaiters.set(slots, byIndex);
		}
		const list = byIndex.get(index);
		if (list) list.push(resolve);
		else byIndex.set(index, [resolve]);
	});
}

function resolveMountWaiters(slots: object, index: number): void {
	const byIndex = mountWaiters.get(slots);
	const list = byIndex?.get(index);
	if (!byIndex || !list) return;
	byIndex.delete(index);
	for (const resolve of list) resolve();
}
