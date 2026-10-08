/**
 * Pure per-list geometry for windowing, kept apart from the reactive wiring in
 * `list-windowing.svelte.ts` so it can be unit-tested without mounting a component.
 */
import { FALLBACK_CONTENT_WIDTH } from './typography-estimates';

/** This list's own content element, not the scroll container: nested content lays out narrower,
 *  and the height estimator wraps more lines the narrower it gets. */
export function estimateWidth(listEl: { clientWidth: number } | null, portWidth: number): number {
	return listEl?.clientWidth || portWidth || FALLBACK_CONTENT_WIDTH;
}

/** The offset that converts the scroll container's `scrollTop` into this list's range. Viewport
 *  top and scroll offset are separate terms: an editor partway down a scrolling page has both. */
export function listTopWithinContent(
	listTop: number,
	viewportTop: number,
	scrollTop: number
): number {
	return listTop - viewportTop + scrollTop;
}

/** Each nested list covers only part of the viewport; windowing each against the full height
 *  would mount O(viewport × lists) blocks. Pass client height, which leaves out the scrollbar. */
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
