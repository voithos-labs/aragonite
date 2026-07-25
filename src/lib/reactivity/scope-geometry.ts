/**
 * Pure per-scope geometry for windowing. Each activated nested container maps the
 * single editor scroll element into its own coordinate range and estimates its
 * children's heights at its OWN content width. These helpers isolate that math
 * from the reactive wiring in `list-windowing.svelte.ts` so it can be unit-tested
 * without mounting a component.
 */

/** Width to estimate this scope's children at: its own content element, not the
 *  editor root. Nested content lays out narrower (indent/padding) and the oracle's
 *  line-wrap is monotonic in width, so the root width systematically undercounts at
 *  depth. Falls back to the root, then a constant, when neither element is mounted. */
import { FALLBACK_CONTENT_WIDTH } from '../cursor/typography-estimates';

export function estimateWidth(
	listEl: { clientWidth: number } | null,
	scrollEl: { clientWidth: number } | null
): number {
	return listEl?.clientWidth || scrollEl?.clientWidth || FALLBACK_CONTENT_WIDTH;
}

/** This scope's effective viewport height: the height of the intersection between
 *  the editor viewport and the scope's own box. Each nested scope only occupies
 *  part of the viewport, so windowing against the full editor height would mount
 *  O(viewport × active-scope-count) blocks instead of O(viewport). The viewport is
 *  given as a top + visible (client) height so the intersection excludes the
 *  scrollbar/border the way the editor's own visible area does. */
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
