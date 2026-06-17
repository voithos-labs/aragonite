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
}

/**
 * Bring child `index` into its window before a caller reads its ref: drop a stale
 * off-window ref, scroll it in via `revealChild`, and await its mount. The
 * bare-index mount waiter can wake on a same-index mount at another nesting level,
 * so re-check this scope's own slot until its child is actually present. An adjacent
 * (already-mounted, non-stale) child returns with no scroll. Shared by the canonical
 * container reveal and TableBlock's hand-rolled one so the "is this slot a live
 * mount" gate lives in one place.
 */
export async function revealChildOrWait(index: number, opts: RevealChildOptions): Promise<void> {
	const stale = opts.isStale?.(index) ?? false;
	if (index < opts.childCount && (stale || !opts.getRef(index))) {
		if (stale) opts.dropRef?.(index);
		await opts.revealChild(index);
		while (!opts.getRef(index)) {
			await whenRefMounted(index, () => !!opts.getRef(index));
		}
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
