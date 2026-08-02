import { tick } from 'svelte';

/**
 * A scope's ref-slot array, reached only through the accessors its owner mints. Object
 * identity IS the scope: the mount registry keys on it, so a mount in one scope cannot wake
 * a waiter in another (a nested level, a sibling container, a second editor instance).
 */
export interface RefSlots<T> {
	set(index: number, ref: T | undefined): void;
	get(index: number): T | undefined;
}

/** Mints a scope over a ref array reached through a live getter, so replacing the array
 *  (a document swap, a length reconcile) keeps the scope's one identity. */
export function refSlotsOver<T>(readRefs: () => (T | undefined)[]): RefSlots<T> {
	return {
		set: (index, ref) => {
			readRefs()[index] = ref;
		},
		get: (index) => readRefs()[index]
	};
}

/**
 * Replaces `bind:this={refs[i]}` in a keyed each — Svelte 5's `bind:this` doesn't re-target
 * when the iteration index shifts. Cleanup is conditional because effect-cleanup order
 * across siblings isn't guaranteed, and an unconditional clear stomps a neighbor's slot.
 */
export function publishRefSlot<T>(
	slots: RefSlots<T>,
	index: number,
	ref: T | undefined
): () => void {
	const capturedIndex = index;
	const capturedRef = ref;
	slots.set(capturedIndex, capturedRef);
	if (capturedRef !== undefined) resolveMountWaiters(slots, capturedIndex);
	return () => {
		if (slots.get(capturedIndex) === capturedRef) {
			slots.set(capturedIndex, undefined);
		}
	};
}

// ── Windowed reveal-and-wait ─────────────────────────────────────────────────

export interface RevealChildOptions<T> {
	/** This scope's ref slots: the read/drop surface, and the mount-wait's scope key. */
	readonly slots: RefSlots<T>;
	/** This scope's child count; an index at or past it can never mount (size lag). */
	readonly childCount: number;
	/** Scroll this scope so child `index` enters its window; resolves after a tick. */
	readonly revealChild: (index: number) => Promise<void>;
	/** True when the published ref at `index` is stale — its child scrolled off-window and
	 *  the windowed each-block's conditional cleanup left a detached ref. Slot truthiness
	 *  alone is a cache, not a mount oracle; a stale slot is dropped so the mount-wait
	 *  resolves on the FRESH child. Omitted where cleanup always clears the slot. */
	readonly isStale?: (index: number) => boolean;
	/** True iff `index` is inside the scope's CURRENT mounted window, read AFTER
	 *  `revealChild` resolved. The termination guarantee (VR-5): without proving membership
	 *  first, a scroll that missed leaves the loop waiting on a mount that never fires. */
	readonly isInWindow?: (index: number) => boolean;
}

/** Each wait races a tick, so a scope with no membership oracle would spin forever on a
 *  child that never publishes. This bounds those turns. */
const MAX_MOUNT_REWAITS = 64;

/**
 * Bring child `index` into its window before a caller reads its ref: drop a stale
 * off-window ref, scroll it in, and await its mount. Shared by the canonical container
 * reveal and TableBlock's hand-rolled one, so the "is this slot a live mount" gate has one
 * home. Termination (VR-5): only a mount at this index in THIS scope wakes the wait, so a
 * windowing caller proves membership first and a non-windowing one races each wait against
 * a tick; both degrade to operating on path state rather than parking forever.
 */
export async function revealChildOrWait<T>(
	index: number,
	opts: RevealChildOptions<T>
): Promise<void> {
	const stale = opts.isStale?.(index) ?? false;
	if (index >= opts.childCount || (!stale && opts.slots.get(index))) return;
	if (stale) opts.slots.set(index, undefined);
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
		await Promise.race([whenRefMounted(opts.slots, index, () => !!opts.slots.get(index)), tick()]);
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
export function whenRefMounted<T>(
	slots: RefSlots<T>,
	index: number,
	isPresent: () => boolean
): Promise<void> {
	if (isPresent()) return Promise.resolve();
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
