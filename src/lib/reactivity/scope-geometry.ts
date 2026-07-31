/**
 * Pure per-scope geometry for windowing, isolated from the reactive wiring in
 * `list-windowing.svelte.ts` so it can be unit-tested without mounting a component.
 */

/** This scope's own content element, not the editor root: nested content lays out narrower
 *  and the oracle's line-wrap is monotonic in width, so the root width undercounts at
 *  depth. Falls back to the root, then a constant, when neither element is mounted. */
import { FALLBACK_CONTENT_WIDTH } from '../cursor/typography-estimates';

export function estimateWidth(
	listEl: { clientWidth: number } | null,
	scrollEl: { clientWidth: number } | null
): number {
	return listEl?.clientWidth || scrollEl?.clientWidth || FALLBACK_CONTENT_WIDTH;
}

/** The intersection of the editor viewport with this scope's own box. Each nested scope
 *  occupies only part of the viewport, so windowing against the full editor height would
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
