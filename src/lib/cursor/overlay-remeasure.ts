/**
 * Shared scroll-listener wiring for DecorationOverlay and SelectionOverlay: measure on mount, on
 * scroll, and when the table's row-window `$derived` moves. Windowed tables need that third
 * trigger: a raw 'scroll' fires before the windowed `{#each}` mounts the new rows, so only the
 * dependency-driven re-run measures after the commit.
 */

import { untrack } from 'svelte';
import type { BlockComponent } from '../block-component';
import { firstScrollableDescendant, nearestScrollContainer } from './scroll-ancestors';
import { observeResize } from './observe-resize';

export function wireOverlayRemeasure(opts: {
	el: HTMLElement;
	editorRoot: HTMLElement | null;
	blockRef: BlockComponent | undefined;
	measure: () => void;
	/** Run the setup measure untracked, for a caller whose `measure` reads the document: tracking
	 *  it would tear down and re-wire these listeners on every keystroke. Scoped to that one call,
	 *  never the whole wiring, since the row-window read below must stay tracked either way. */
	untrackSetupMeasure?: boolean;
}): () => void {
	const { el, editorRoot, blockRef, measure } = opts;

	// Plain synchronous read so the enclosing $effect depends on the table's row-window
	// $derived; it must not be inside untrack().
	blockRef?.mountedRowWindow?.();

	if (opts.untrackSetupMeasure) untrack(measure);
	else measure();

	const scrollEl =
		firstScrollableDescendant(el) ?? (editorRoot ? nearestScrollContainer(el, editorRoot) : null);

	const disposers: Array<() => void> = [];

	if (scrollEl) {
		scrollEl.addEventListener('scroll', measure, { passive: true });
		disposers.push(() => scrollEl.removeEventListener('scroll', measure));
	}

	// The editor root's vertical scroll is distinct from a block's inner scroll container;
	// this covers the non-windowed repaint-on-scroll path.
	if (editorRoot && editorRoot !== scrollEl) {
		editorRoot.addEventListener('scroll', measure, { passive: true });
		disposers.push(() => editorRoot.removeEventListener('scroll', measure));
	}

	// The block's own box changing under a live range (a paragraph set to a heading, a font
	// load) moves the text the rects were measured against.
	disposers.push(observeResize(el, () => measure()));

	return () => disposers.forEach((dispose) => dispose());
}
