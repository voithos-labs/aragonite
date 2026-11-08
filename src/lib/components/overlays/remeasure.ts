/**
 * When DecorationOverlay and SelectionOverlay measure: on the frame after they wire (blocks that
 * mount together then measure in one layout, VR-4), on scroll, when the block's box resizes, when
 * text inside it moves without a resize (`text-moves.ts`), and when a windowed table's mounted
 * rows change, since a raw scroll fires before those rows mount.
 */

import { untrack } from 'svelte';
import type { BlockComponent } from '../../block-component';
import {
	firstScrollableDescendant,
	nearestScrollContainer
} from '../../windowing/scroll-ancestors';
import { observeResize } from '../../windowing/observe-resize';
import type { TextMoves } from './text-moves';

export function wireOverlayRemeasure(opts: {
	el: HTMLElement;
	editorRoot: HTMLElement | null;
	blockRef: BlockComponent | undefined;
	measure: () => void;
	/** Measure before returning (untracked): for one element that must sit in place before focus
	 *  moves into it, the link card. Blocks that mount together leave this off. */
	measureNow?: boolean;
	/** Absent only for an overlay mounted without the editor, which has no services to read. */
	textMoves?: TextMoves;
}): () => void {
	const { el, editorRoot, blockRef, measure, textMoves } = opts;

	// A plain synchronous read, so the enclosing $effect depends on the table's row-window $derived.
	blockRef?.mountedRowWindow?.();

	// Next frame: a read between two mounting blocks' writes forces a layout per block, and one
	// inside a resize delivery turns another element's pending write into a loop error.
	let live = true;
	const cancelFrame = opts.measureNow ? () => {} : onNextFrame(() => live && measure());
	if (opts.measureNow) untrack(measure);

	const scrollEl =
		firstScrollableDescendant(el) ?? (editorRoot ? nearestScrollContainer(el, editorRoot) : null);

	const disposers: Array<() => void> = [
		() => {
			live = false;
			cancelFrame();
		}
	];

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

// ── The shared frame ─────────────────────────────────────────────────────────

const pendingReads: Array<() => void> = [];
let frameAsked = false;

/** Runs `read` with every other overlay's on the next frame (G4.4 allowlist), one after another,
 *  so their state writes flush once after all the reads. Returns the cancel. */
function onNextFrame(read: () => void): () => void {
	pendingReads.push(read);
	if (!frameAsked) {
		frameAsked = true;
		requestAnimationFrame(() => {
			frameAsked = false;
			const reads = pendingReads.splice(0);
			for (const run of reads) run();
		});
	}
	return () => {
		const i = pendingReads.indexOf(read);
		if (i >= 0) pendingReads.splice(i, 1);
	};
}
