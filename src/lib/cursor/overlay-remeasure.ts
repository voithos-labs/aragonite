/**
 * Shared scroll-listener wiring for DecorationOverlay and SelectionOverlay: measure on
 * mount, on scroll, and on the table's row-window `$derived` moving. That third trigger is
 * load-bearing for windowed tables — a raw 'scroll' fires BEFORE the windowed `{#each}`
 * mounts the new rows, so only the dep-based re-run measures post-commit.
 */

import { untrack } from 'svelte';
import type { BlockComponent } from '../block-component';
import { firstScrollableDescendant, nearestScrollContainer } from './scroll-ancestors';

export function wireOverlayRemeasure(opts: {
	el: HTMLElement;
	editorRoot: HTMLElement | null;
	blockRef: BlockComponent | undefined;
	measure: () => void;
	/** Run the SETUP measure untracked, for a caller whose `measure` reads the document: tracking
	 *  it would tear down and re-wire these listeners on every keystroke. Scoped to that one call,
	 *  never the whole wiring — the row-window read below must stay tracked either way. */
	untrackSetupMeasure?: boolean;
}): () => void {
	const { el, editorRoot, blockRef, measure } = opts;

	// Plain synchronous read so the enclosing $effect registers as a dep of the table's win
	// $derived. Must NOT be inside untrack().
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

	return () => disposers.forEach((dispose) => dispose());
}
