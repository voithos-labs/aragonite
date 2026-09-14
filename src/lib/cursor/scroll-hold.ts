/**
 * Scroll-position hold across a block's render swap. A swap that shortens a block clamps the
 * scrollport against the transient layout on the way to its settled height, and the clamp is
 * never given back. A reveal in flight outranks the hold and owns the position; host mode does
 * not, since native anchoring cannot undo a max-scroll clamp. Only a measure-then-fit surface
 * needs this, and today that is one: an editable leaf's source is content-sized at mount.
 */

import { tick } from 'svelte';
import { userScrollportFor } from './scroll-ancestors';
import { createScrollport } from './scrollport';

/** Capture the position of whatever scrolls `el`; await the result AFTER the state flip that
 *  changes the block's height. */
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
