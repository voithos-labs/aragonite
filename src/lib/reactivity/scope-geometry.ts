/**
 * Pure per-list geometry for windowing, kept apart from the reactive wiring in
 * `list-windowing.svelte.ts` so it can be unit-tested without mounting a component.
 */
import { FALLBACK_CONTENT_WIDTH } from '../cursor/typography-estimates';

/** This list's own content element, not the scroll container: nested content lays out
 *  narrower and the height estimator wraps more lines the narrower it gets, so the container's
 *  width undercounts at depth. Falls back to the container, then a constant. */
export function estimateWidth(listEl: { clientWidth: number } | null, portWidth: number): number {
	return listEl?.clientWidth || portWidth || FALLBACK_CONTENT_WIDTH;
}

/**
 * This list's top in the scroll container's content space: the offset that converts the
 * container's `scrollTop` into the list's own range. The two container terms are different and
 * both needed: an editor embedded partway down a page that scrolls has a nonzero scroll and
 * content above it, and treating them as one slices the window a band off.
 */
export function listTopWithinContent(
	listTop: number,
	viewportTop: number,
	scrollTop: number
): number {
	return listTop - viewportTop + scrollTop;
}

/** The intersection of the scroll container's viewport with this list's own box. Each nested
 *  list takes up only part of the viewport, so windowing against the full container height
 *  would mount O(viewport × number of lists) blocks. The viewport arrives as top plus client
 *  height, so the intersection leaves out the scrollbar and border. */
export function effectiveViewportHeight(
	viewportTop: number,
	viewportHeight: number,
	scopeTop: number,
	scopeHeight: number
): number {
	const top = Math.max(viewportTop, scopeTop);
	const bottom = Math.min(viewportTop + viewportHeight, scopeTop + scopeHeight);
	return Math.max(0, bottom - top);
}
