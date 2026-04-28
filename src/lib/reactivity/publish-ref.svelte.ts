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
	return () => {
		if (getRef(capturedIndex) === capturedRef) {
			setRef(capturedIndex, undefined);
		}
	};
}
