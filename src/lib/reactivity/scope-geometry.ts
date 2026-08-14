/**
 * Pure per-scope geometry for windowing, isolated from the reactive wiring in
 * `list-windowing.svelte.ts` so it can be unit-tested without mounting a component.
 */
import { FALLBACK_CONTENT_WIDTH } from '../cursor/typography-estimates';

/** This scope's own content element, not the scrollport: nested content lays out narrower and
 *  the oracle's line-wrap is monotonic in width, so the port width undercounts at depth. Falls
 *  back to the port, then a constant, when neither is measurable. */
export function estimateWidth(listEl: { clientWidth: number } | null, portWidth: number): number {
	return listEl?.clientWidth || portWidth || FALLBACK_CONTENT_WIDTH;
}

/**
 * This scope's list top in the scrollport's CONTENT space — the offset mapping port scrollTop
 * into the scope's local range. The two port terms are distinct and both load-bearing: an editor
 * embedded partway down a page-scrolled shell has a nonzero scroll AND page chrome above it, and
 * conflating them slices the window a band off.
 */
export function listTopWithinContent(
	listTop: number,
	viewportTop: number,
	scrollTop: number
): number {
	return listTop - viewportTop + scrollTop;
}

/** The intersection of the port's viewport with this scope's own box. Each nested scope
 *  occupies only part of the viewport, so windowing against the full port height would
 *  mount O(viewport × active-scope-count) blocks. The viewport arrives as top + client
 *  height so the intersection excludes the scrollbar/border. */
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
