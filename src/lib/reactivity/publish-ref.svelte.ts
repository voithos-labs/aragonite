import { tick, untrack } from 'svelte';

/**
 * A scope's ref-slot array, reached only through the accessors its owner mints. Object
 * identity IS the scope: the mount registry keys on it, so a mount in one scope cannot wake
 * a waiter in another (a nested level, a sibling container, a second editor instance).
 */
export interface RefSlots<T> {
	set(index: number, ref: T | undefined): void;
	get(index: number): T | undefined;
}

/** Mints a scope over its ref array. Takes the array itself, not a getter, so a scope
 *  cannot be re-aimed at a replacement: Svelte pins a teardown's reads to pre-flush values,
 *  so a swapped array takes each cleanup's clear with it and strands the dead ref in the
 *  live one. Publish a new set of contents with `replaceRefs`. */
export function refSlotsOver<T>(refs: (T | undefined)[]): RefSlots<T> {
	return {
		set: (index, ref) => {
			refs[index] = ref;
		},
		get: (index) => refs[index]
	};
}

/** Publishes a whole slot array in place, the only sanctioned way to replace a scope's
 *  contents wholesale (see `refSlotsOver` for why identity is load-bearing). */
export function replaceRefs<T>(
	target: (T | undefined)[],
	values: readonly (T | undefined)[]
): void {
	target.length = values.length;
	for (let i = 0; i < values.length; i++) target[i] = values[i];
}

/**
 * Replaces `bind:this={refs[i]}` in a keyed each — Svelte 5's `bind:this` doesn't re-target
 * when the iteration index shifts. Cleanup is conditional because effect-cleanup order
 * across siblings isn't guaranteed, and an unconditional clear stomps a neighbor's slot.
 * `el` is the ref's own box, which is what makes `isSlotDetached` answerable.
 */
export function publishRefSlot<T>(
	slots: RefSlots<T>,
	index: number,
	ref: T | undefined,
	el?: Element | null
): () => void {
	slots.set(index, ref);
	if (el && typeof ref === 'object' && ref !== null) publishedElements.set(ref, el);
	// The cleanup's identity check compares against what the slot actually holds, not the raw
	// ref; untracked, since publishers run inside effects and would self-invalidate.
	const publishedRef = untrack(() => slots.get(index));
	if (publishedRef !== undefined) resolveMountWaiters(slots, index);
	return () => {
		if (slots.get(index) === publishedRef) {
			slots.set(index, undefined);
		}
	};
}

// ── Mount attachment ─────────────────────────────────────────────────────────

// Keyed on ref identity, not on (slots, index): a wholesale `replaceRefs` re-seats a saved
// ref no publisher will run for again, and only the ref itself still knows its box. Weak,
// so the entry dies with the ref rather than outliving the scope.
const publishedElements = new WeakMap<object, Element>();

/**
 * True when the slot's ref is a mount that already left the DOM. The one home for the
 * question every reveal asks before trusting a filled slot — and it is an ATTACHMENT
 * question, never a window-membership one: a programmatic scroll moves the slice a flush
 * before the DOM follows, so "off-window" clears refs whose components are still mounted
 * and which nothing re-publishes. A ref with no recorded box degrades to live.
 */
function isSlotDetached<T>(slots: RefSlots<T>, index: number): boolean {
	const ref = slots.get(index);
	if (typeof ref !== 'object' || ref === null) return false;
	const el = publishedElements.get(ref);
	return el !== undefined && !el.isConnected;
}

// ── Windowed reveal-and-wait ─────────────────────────────────────────────────

export interface RevealChildOptions<T> {
	/** This scope's ref slots: the read/drop surface, and the mount-wait's scope key. */
	readonly slots: RefSlots<T>;
	/** This scope's child count; an index at or past it can never mount (size lag). */
	readonly childCount: number;
	/** Scroll this scope so child `index` enters its window; resolves after a tick. */
	readonly revealChild: (index: number) => Promise<void>;
	/** True iff `index` is inside the scope's CURRENT mounted window, read AFTER `revealChild`
	 *  resolved (VR-5's termination guarantee). Optional only for a scope that does not window:
	 *  every production reveal supplies it, so the bounded re-wait below is the harness
	 *  fallback, not a live path. */
	readonly isInWindow?: (index: number) => boolean;
}

/** Each wait races a tick, so a scope with no membership oracle would spin forever on a
 *  child that never publishes. This bounds those turns. */
const MAX_MOUNT_REWAITS = 64;

/**
 * Bring child `index` into its window before a caller reads its ref: drop a detached ref,
 * scroll it in, and await its mount. Shared by the canonical container reveal and TableBlock's
 * hand-rolled one, so the "is this slot a live mount" gate has one home. Termination (VR-5): only
 * a mount at this index in THIS scope wakes the wait, so a windowing caller proves membership
 * first and a non-windowing one races each wait against a tick, rather than parking forever.
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
		// Provably outside the recomputed window → the mount can't fire; degrade now.
		if (!opts.isInWindow(index)) return;
		// In-window, the mount flush is at most one tick away; still unpublished after it
		// means a failed-render boundary left bind:this unset, waking no waiter.
		await tick();
		return;
	}
	// Membership unknowable: bounded mount-wait, each raced against a tick so a child that
	// never publishes degrades within the cap instead of parking forever.
	let rewaits = 0;
	while (!opts.slots.get(index) && rewaits++ < MAX_MOUNT_REWAITS) {
		await Promise.race([whenRefMounted(opts.slots, index), tick()]);
	}
}

// ── Mount-await registry ─────────────────────────────────────────────────────

const mountWaiters = new WeakMap<object, Map<number, Array<() => void>>>();

/**
 * Resolve when slot `index` of `slots` is (or becomes) populated. Event-driven, woken by
 * `publishRefSlot` on a real mount, never a timer (Design Rule #2 / G4.4). A wake can still
 * be spurious within one scope: a mount that unpublishes in the same flush leaves the slot
 * empty, so the caller re-checks.
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
