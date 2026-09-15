/**
 * Keeping the scroll position across a block's render swap. A swap that shortens a block clamps
 * the scroll container against the transient layout on the way to the final height, and the
 * clamp is never given back. A scroll-into-view in progress outranks this and owns the position;
 * host scroll mode does not, since native scroll anchoring cannot undo a max-scroll clamp. Only a
 * block that measures and then fits needs this: an editable block's source is content-sized at mount.
 */

import { tick } from 'svelte';
import { userScrollportFor } from './scroll-ancestors';
import { createScrollport } from './scrollport';

/** Capture the position of whatever scrolls `el`; await the result after the state change
 *  that changes the block's height. */
export function captureScrollPosition(
	el: HTMLElement | null | undefined,
	isRevealInFlight: () => boolean
): () => Promise<void> {
	const port = el ? createScrollport(userScrollportFor(el)) : null;
	const before = port?.scrollTop() ?? 0;
	return async () => {
		await tick();
		if (!port || isRevealInFlight() || port.scrollTop() === before) return;
		port.setScrollTop(before);
	};
}
