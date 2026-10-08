/** A block list's child-component refs, and scrolling a child into the mounted range before
 *  reading its ref. */
import { tick, untrack } from 'svelte';

/** One block list's child-component refs, reached only through these accessors. Neither is
 *  reactive; `revealChildOrWait` is how a caller waits for a child to mount. */
export interface RefSlots<T> {
	set(index: number, ref: T | undefined): void;
	get(index: number): T | undefined;
}

/** Takes the array itself, never a getter: a cleanup run against a replaced array would leave a
 *  dead ref in the live one. Replace contents with `replaceRefs`. */
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

/** Replaces `bind:this={refs[i]}` in a keyed each, which doesn't re-target when the index
 *  shifts. `el` is the ref's own box, which `isSlotDetached` reads. */
export function publishRefSlot<T>(
	slots: RefSlots<T>,
	index: number,
	ref: T | undefined,
	el?: Element | null
): () => void {
	slots.set(index, ref);
	if (el && typeof ref === 'object' && ref !== null) publishedElements.set(ref, el);
	// Sibling cleanups run in no set order, so a cleanup clears the entry only if it still holds
	// this mount's ref; read untracked, since writers run inside effects.
	const publishedRef = untrack(() => slots.get(index));
	return () => {
		if (slots.get(index) === publishedRef) {
			slots.set(index, undefined);
		}
	};
}

// ── Mount attachment ─────────────────────────────────────────────────────────

// Keyed on the ref, not (slots, index): a wholesale `replaceRefs` moves a saved ref that no
// writer will run for again, and only the ref itself still knows its box.
const publishedElements = new WeakMap<object, Element>();

/** True when the entry's ref is a mount whose element already left the DOM. Asks the DOM, never
 *  the mounted range, which moves a flush before the DOM follows. A ref with no box is live. */
function isSlotDetached<T>(slots: RefSlots<T>, index: number): boolean {
	const ref = slots.get(index);
	if (typeof ref !== 'object' || ref === null) return false;
	const el = publishedElements.get(ref);
	return el !== undefined && !el.isConnected;
}

// ── Scroll a child in and wait for it ────────────────────────────────────────

export interface RevealChildOptions<T> {
	/** This list's ref entries: what the wait reads, and clears when a ref left the DOM. */
	readonly slots: RefSlots<T>;
	/** This list's child count; an index at or past it can never mount. */
	readonly childCount: number;
	/** Scroll this list so child `index` is in the mounted range; resolves after a tick. */
	readonly revealChild: (index: number) => Promise<void>;
	/** True when `index` is in the list's mounted range after `revealChild`, which lets the wait
	 *  give up instead of hanging (VR-5). */
	readonly isInWindow: (index: number) => boolean;
}

/** Brings child `index` into the mounted range before a caller reads its ref: drops a ref that
 *  left the DOM, scrolls the child in, and waits for its mount, giving up when it cannot come. */
export async function revealChildOrWait<T>(
	index: number,
	opts: RevealChildOptions<T>
): Promise<void> {
	const detached = isSlotDetached(opts.slots, index);
	if (index >= opts.childCount || (!detached && opts.slots.get(index))) return;
	if (detached) opts.slots.set(index, undefined);
	await opts.revealChild(index);
	// Outside the recomputed range the mount cannot fire, so give up now.
	if (opts.slots.get(index) || !opts.isInWindow(index)) return;
	// Inside it the mount flush is at most one tick away; an entry still empty after it means a
	// failed render left `bind:this` unset.
	await tick();
}
