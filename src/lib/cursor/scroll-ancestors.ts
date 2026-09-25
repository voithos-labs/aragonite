/**
 * Ancestor walks for "what scrolls" (the first `auto`/`scroll` ancestor) and "what clips" (the
 * whole chain of ancestors bounding the visible region, since visibility is their intersection).
 * `selection/drag-pointer.ts` keeps its own inner walk, so a change here does not change it.
 */

// Scrollable through script: `element.scrollTop = n` moves it. `hidden` qualifies.
const SCRIPT_SCROLLABLE_VALUES = new Set(['auto', 'scroll', 'hidden']);
// Scrollable by the user, which is what a drag may autoscroll. `hidden` is excluded by
// convention, not capability: a user cannot wheel it back, so autoscrolling it would
// strand content out of reach.
const USER_SCROLLABLE_VALUES = new Set(['auto', 'scroll']);
// What can bound the visible region. `clip` joins here and only here: it never scrolls,
// so it is no autoscroll answer, but a block past its edge is unreachable.
const VIEW_BOUNDING_VALUES = new Set([...SCRIPT_SCROLLABLE_VALUES, 'clip']);

function isScriptScrollable(el: HTMLElement): boolean {
	const cs = getComputedStyle(el);
	return SCRIPT_SCROLLABLE_VALUES.has(cs.overflowX) || SCRIPT_SCROLLABLE_VALUES.has(cs.overflowY);
}

// Never a candidate in either walk: when the page box is the scroll container, the window
// viewport is the rect to measure and the thing to scroll, and neither box is that rect.
function isPageBox(el: HTMLElement): boolean {
	return el === document.body || el === document.documentElement;
}

export function nearestScrollContainer(el: HTMLElement, stopAt: HTMLElement): HTMLElement | null {
	let cur: HTMLElement | null = el.parentElement;
	while (cur && cur !== stopAt) {
		if (isScriptScrollable(cur)) return cur;
		cur = cur.parentElement;
	}
	return null;
}

/** What a drag can autoscroll: an element, or the page's own viewport. */
export type UserScrollport = HTMLElement | Window;

/**
 * What a drag autoscrolls to bring more of `el` into reach: the nearest user-scrollable
 * ancestor, or the window when the page's own viewport is the scroll container. Always answers
 * on purpose: a null for the page-scrolled case would read as "no autoscroll target", and
 * `document.scrollingElement` is no substitute (its rect is the document box).
 */
export function userScrollportFor(el: HTMLElement): UserScrollport {
	let cur: HTMLElement | null = el.parentElement;
	while (cur && !isPageBox(cur)) {
		const cs = getComputedStyle(cur);
		if (USER_SCROLLABLE_VALUES.has(cs.overflowX) || USER_SCROLLABLE_VALUES.has(cs.overflowY)) {
			return cur;
		}
		cur = cur.parentElement;
	}
	return window;
}

/**
 * Every ancestor that bounds what can be seen of `el`, outermost-last. The whole chain,
 * not the nearest: only the intersection answers "is this visible", and the innermost
 * match alone can be a rounded card that bounds nothing. Callers intersect the window
 * viewport with these; an empty result means the window alone bounds it.
 */
export function clippingAncestors(el: HTMLElement): HTMLElement[] {
	const bounds: HTMLElement[] = [];
	let cur: HTMLElement | null = el.parentElement;
	while (cur && !isPageBox(cur)) {
		const cs = getComputedStyle(cur);
		if (VIEW_BOUNDING_VALUES.has(cs.overflowX) || VIEW_BOUNDING_VALUES.has(cs.overflowY)) {
			bounds.push(cur);
		}
		cur = cur.parentElement;
	}
	return bounds;
}

/** First scrollable descendant of `el` in document order. A block-host wrapper sits
 *  outside a block's internal scroll container, so finding what scrolls beneath the host
 *  means looking inward, not up. */
export function firstScrollableDescendant(el: HTMLElement): HTMLElement | null {
	const queue: HTMLElement[] = [];
	for (const child of el.children) {
		if (child instanceof HTMLElement) queue.push(child);
	}
	while (queue.length > 0) {
		const cur = queue.shift()!;
		if (isScriptScrollable(cur)) return cur;
		for (const child of cur.children) {
			if (child instanceof HTMLElement) queue.push(child);
		}
	}
	return null;
}
