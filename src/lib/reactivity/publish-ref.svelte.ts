import { tick } from 'svelte';

/**
 * Replaces `bind:this={refs[i]}` in a keyed each — Svelte 5's `bind:this` doesn't re-target
 * when the iteration index shifts. Cleanup is conditional because effect-cleanup order
 * across siblings isn't guaranteed, and an unconditional clear stomps a neighbor's slot.
 */
export function publishRefSlot<T>(
	index: number,
	ref: T | undefined,
	setRef: (i: number, r: T | undefined) => void,
	getRef: (i: number) => T | undefined
): () => void {
	const capturedIndex = index;
	const capturedRef = ref;
	setRef(capturedIndex, capturedRef);
	if (capturedRef !== undefined) resolveMountWaiters(capturedIndex);
	return () => {
		if (getRef(capturedIndex) === capturedRef) {
			setRef(capturedIndex, undefined);
		}
	};
}

// ── Windowed reveal-and-wait ─────────────────────────────────────────────────

export interface RevealChildOptions {
	/** This scope's child count; an index at or past it can never mount (size lag). */
	readonly childCount: number;
	/** Read the ref slot at `index` — truthy means a ref is published there. */
	readonly getRef: (index: number) => unknown;
	/** Scroll this scope so child `index` enters its window; resolves after a tick. */
	readonly revealChild: (index: number) => Promise<void>;
	/** Clear the slot at `index`. Required wherever `isStale` can report true, so the
	 *  mount-wait resolves on the FRESH child rather than the detached one. */
	readonly dropRef?: (index: number) => void;
	/** True when the published ref at `index` is stale — its child scrolled off-window and
	 *  the windowed each-block's conditional cleanup left a detached ref. Slot truthiness
	 *  alone is a cache, not a mount oracle. Omitted where cleanup always clears the slot. */
	readonly isStale?: (index: number) => boolean;
	/** True iff `index` is inside the scope's CURRENT mounted window, read AFTER
	 *  `revealChild` resolved. The termination guarantee (VR-5): without proving membership
	 *  first, a scroll that missed leaves the loop waiting on a mount that never fires. */
	readonly isInWindow?: (index: number) => boolean;
}

/** The waiter registry is keyed by bare index and shared across nesting levels, so a wake
 *  can be spurious and the reveal re-waits. Capped so a wake storm can't spin unboundedly. */
const MAX_MOUNT_REWAITS = 64;

/**
 * Bring child `index` into its window before a caller reads its ref: drop a stale
 * off-window ref, scroll it in, and await its mount. Shared by the canonical container
 * reveal and TableBlock's hand-rolled one, so the "is this slot a live mount" gate has one
 * home. Termination (VR-5): only a same-index mount wakes the wait, so a windowing caller
 * proves membership first and a non-windowing one races each wait against a tick; both
 * degrade to operating on path state rather than parking on a mount that never fires.
 */
export async function revealChildOrWait(index: number, opts: RevealChildOptions): Promise<void> {
	const stale = opts.isStale?.(index) ?? false;
	if (index >= opts.childCount || (!stale && opts.getRef(index))) return;
	if (stale) opts.dropRef?.(index);
	await opts.revealChild(index);
	if (opts.getRef(index)) return;
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
	while (!opts.getRef(index) && rewaits++ < MAX_MOUNT_REWAITS) {
		await Promise.race([whenRefMounted(index, () => !!opts.getRef(index)), tick()]);
	}
}

// ── Mount-await registry ─────────────────────────────────────────────────────

const mountWaiters = new Map<number, Array<() => void>>();

/**
 * Resolve when the ref slot at `index` is (or becomes) populated. Event-driven — woken by
 * `publishRefSlot` on a real mount, never a timer (Design Rule #2 / G4.4). The map is
 * keyed by bare index and shared across nesting levels, so a nested block mounting at the
 * same local index can wake a top-level waiter spuriously; callers re-check and re-wait.
 */
export function whenRefMounted(index: number, isPresent: () => boolean): Promise<void> {
	if (isPresent()) return Promise.resolve();
	return new Promise((resolve) => {
		const list = mountWaiters.get(index) ?? [];
		list.push(resolve);
		mountWaiters.set(index, list);
	});
}

function resolveMountWaiters(index: number): void {
	const list = mountWaiters.get(index);
	if (!list) return;
	mountWaiters.delete(index);
	for (const resolve of list) resolve();
}
