/**
 * Shared scroll-listener helper for DecorationOverlay and SelectionOverlay.
 *
 * Three triggers call measure():
 *   1. Immediate call on mount (covers the initial paint).
 *   2. 'scroll' on the nearest scrollable descendant/ancestor — handles horizontal
 *      scroll inside a table, or any block embedded in a scroll container.
 *   3. blockRef.mountedRowWindow?.() — reads the table's row-window $derived (win),
 *      registering this $effect as a dep. When the row window re-slices (after a
 *      vertical scroll brings new rows into the mounted set), the effect re-runs
 *      post-flush, AFTER the new rows are committed to the DOM.
 *
 * Trigger 3 is load-bearing for windowed tables: a raw 'scroll' event on the
 * editor root fires BEFORE the windowed {#each} re-slices and mounts the new
 * rows, so cellRect() returns null at that instant. The dep-based re-run is the
 * only path that measures post-commit and sees non-null rects for new rows.
 */

import type { BlockComponent } from '../block-component';
import { firstScrollableDescendant, nearestScrollContainer } from './scroll-ancestors';

export function wireOverlayRemeasure(opts: {
	el: HTMLElement;
	editorRoot: HTMLElement | null;
	blockRef: BlockComponent | undefined;
	measure: () => void;
}): () => void {
	const { el, editorRoot, blockRef, measure } = opts;

	// Trigger 3: plain synchronous read so the enclosing $effect registers as a
	// dep of the table's win $derived. Must NOT be inside untrack().
	blockRef?.mountedRowWindow?.();

	measure();

	const scrollEl =
		firstScrollableDescendant(el) ?? (editorRoot ? nearestScrollContainer(el, editorRoot) : null);

	const disposers: Array<() => void> = [];

	if (scrollEl) {
		scrollEl.addEventListener('scroll', measure, { passive: true });
		disposers.push(() => scrollEl.removeEventListener('scroll', measure));
	}

	// Also listen on the editor root for vertical scroll (distinct from the block's
	// inner scroll container). This covers the non-windowed repaint-on-scroll path.
	if (editorRoot && editorRoot !== scrollEl) {
		editorRoot.addEventListener('scroll', measure, { passive: true });
		disposers.push(() => editorRoot.removeEventListener('scroll', measure));
	}

	return () => disposers.forEach((dispose) => dispose());
}
