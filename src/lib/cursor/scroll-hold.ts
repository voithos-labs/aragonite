/**
 * Scroll-position hold across a block's render swap. A swap that shortens a block clamps the
 * scrollport against the transient layout it passes through on the way to its settled height,
 * and the clamp is never given back; re-asserting after the flush is a no-op when nothing moved
 * and a shrinking document re-clamps the restored value to its own new maximum.
 */

import { tick } from 'svelte';
import { userScrollportFor } from './scroll-ancestors';
import { createScrollport } from './scrollport';

/** Capture the position of whatever scrolls `el`; await the result AFTER the state flip that
 *  changes the block's height. */
export function captureScrollPosition(el: HTMLElement | null | undefined): () => Promise<void> {
	const port = el ? createScrollport(userScrollportFor(el)) : null;
	const before = port?.scrollTop() ?? 0;
	return async () => {
		await tick();
		if (port && port.scrollTop() !== before) port.setScrollTop(before);
	};
}
