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
