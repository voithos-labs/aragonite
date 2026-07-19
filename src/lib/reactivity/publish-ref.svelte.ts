import { tick } from 'svelte';

/**
 * Replaces `bind:this={refs[i]}` in a keyed each — Svelte 5's bind:this
 * doesn't re-target when iteration index shifts. Cleanup is conditional
 * because effect-cleanup order across siblings isn't guaranteed; an
 * unconditional clear can stomp a neighbor's just-written slot.
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
	/**
	 * Clear the slot at `index`. Required when `isStale` can report true: a slot
	 * holding a detached off-window ref must be dropped so the mount-wait below
	 * resolves on the FRESH child, not the stale one.
	 */
	readonly dropRef?: (index: number) => void;
	/**
	 * True when the published ref at `index` is stale (its child scrolled off-window
	 * and the windowed each-block's conditional cleanup left a detached ref). Slot
	 * truthiness alone is a cache, not a mount oracle — a scope that can leave stale
	 * slots passes this so reveal isn't skipped on the detached ref. Omitted by scopes
	 * whose cleanup always clears the slot on unmount (the slot already goes undefined).
	 */
	readonly isStale?: (index: number) => boolean;
	/**
	 * True iff `index` is inside the scope's CURRENT mounted window `[start, end)`,
	 * read AFTER `revealChild` resolved. The termination guarantee (VR-5): the
	 * mount-wait below is woken only by a same-index mount, so if a stale model let
	 * `revealChild`'s one scroll miss — the target still outside the recomputed
	 * window — no mount will ever fire and the loop would hang forever. With this the
	 * caller proves membership before waiting and degrades to null (operate on path
	 * state, skip DOM placement) instead. Omit only for non-windowing callers.
	 */
	readonly isInWindow?: (index: number) => boolean;
}

/**
 * The bare-index mount waiter can wake on a same-index mount at another nesting
 * level (the registry is keyed by local index, shared across scopes), so a reveal
 * re-checks and re-waits. Cap the re-waits so a pathological wake storm can't spin
 * unboundedly even though each genuine wake makes progress. The never-mounts hang is
 * held off two ways: a windowing caller's `isInWindow` check short-circuits before
 * this loop, and the loop itself races each wait against a tick so a non-windowing
 * caller degrades within the cap rather than parking on a wake that never comes.
 */
const MAX_MOUNT_REWAITS = 64;

/**
 * Bring child `index` into its window before a caller reads its ref: drop a stale
 * off-window ref, scroll it in via `revealChild`, and await its mount. An adjacent
 * (already-mounted, non-stale) child returns with no scroll. Shared by the canonical
 * container reveal and TableBlock's hand-rolled one so the "is this slot a live
 * mount" gate lives in one place.
 *
 * Termination (VR-5): the mount-wait is woken ONLY by a same-index mount, so any
 * target whose mount never fires would wait forever — a scroll that missed (stale
 * model left the target outside the recomputed window) or a mounted child that
 * never publishes (failed-render boundary). Windowing callers therefore never
 * enter the open-ended wait: off-window degrades immediately, in-window waits one
 * mount flush then degrades. A non-windowing caller can't prove membership, so it
 * races each mount-wait against a tick and degrades within the re-wait cap. Callers
 * degrade by operating on path state and skipping DOM placement.
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
		// In-window, the mount flush is at most one tick away. A target still
		// unpublished after it never will be — a failed-render boundary leaves
		// bind:this unset and resolves no waiter — so degrade rather than park
		// on a wait nothing can wake.
		await tick();
		return;
	}
	// Membership is unknowable (a non-windowing caller): bounded mount-wait. Wake on
	// a real same-index mount, but race each wait against a tick so a child that never
	// publishes — a failed-render boundary leaves bind:this unset, waking no waiter —
	// degrades within the cap instead of parking on the open-ended event forever (the
	// windowing arm's degrade, adapted where membership can't be proven). A spurious
	// cross-level wake re-checks and re-waits, capped either way.
	let rewaits = 0;
	while (!opts.getRef(index) && rewaits++ < MAX_MOUNT_REWAITS) {
		await Promise.race([whenRefMounted(index, () => !!opts.getRef(index)), tick()]);
	}
}

// ── Mount-await registry ─────────────────────────────────────────────────────

const mountWaiters = new Map<number, Array<() => void>>();

/**
 * Resolve when the ref slot at `index` is (or becomes) populated. Event-driven —
 * woken by publishRefSlot on a real mount, never a timer (Design Rule #2 / G4.4).
 * The map is keyed by bare index and shared across nesting levels, so a nested
 * block mounting at the same local index can wake a top-level waiter spuriously;
 * callers re-check `isPresent` and re-wait (see revealPath in Editor.svelte).
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
