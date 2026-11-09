/**
 * When DecorationOverlay and SelectionOverlay measure: after the flush that wired them, with every
 * other block's reads, on scroll, when the block's box resizes, when text inside it moves without
 * a resize (`text-moves.ts`), and when a windowed table's mounted rows change, since a raw scroll
 * fires before those rows mount.
 */

import type { BlockComponent } from '../../block-component';
import {
	firstScrollableDescendant,
	nearestScrollContainer
} from '../../windowing/scroll-ancestors';
import { observeResize } from '../../windowing/observe-resize';
import { measureAfterTick } from '../../windowing/scroll-owner';
import type { TextMoves } from './text-moves';

export function wireOverlayRemeasure(opts: {
	el: HTMLElement;
	editorRoot: HTMLElement | null;
	blockRef: BlockComponent | undefined;
	measure: () => void;
	/** The editor's `ScrollOwner.measureSoon`. This one and `textMoves` are absent only for an
	 *  overlay mounted without the editor, which has no services to read. */
	measureSoon?: (run: () => void) => void;
	textMoves?: TextMoves;
}): () => void {
	const { el, editorRoot, blockRef, measure, textMoves } = opts;

	// A plain synchronous read, so the enclosing $effect depends on the table's row-window $derived.
	blockRef?.mountedRowWindow?.();

	// Queued, not now: a read between two mounting blocks' writes forces a layout per block.
	let live = true;
	(opts.measureSoon ?? measureAfterTick)(() => live && measure());

	const scrollEl =
		firstScrollableDescendant(el) ?? (editorRoot ? nearestScrollContainer(el, editorRoot) : null);

	const disposers: Array<() => void> = [() => (live = false)];

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

	// The block's own box changing under a live range (a paragraph set to a heading) moves the
	// text the rects were measured against.
	disposers.push(observeResize(el, () => measure()));
	if (textMoves) disposers.push(textMoves.watch(el, measure));

	return () => disposers.forEach((dispose) => dispose());
}
