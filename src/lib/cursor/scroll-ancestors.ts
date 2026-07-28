/**
 * The overflow walks for "what scrolls" and "what clips" — two questions that must
 * NOT be answered by one walk. `overflow: hidden` on an auto-height box (the
 * rounded card a shell wraps content in) matches a clipping predicate while
 * neither clipping nor scrolling: measuring against it re-answers "is this in the
 * document", and autoscrolling it moves nothing. So scrolling asks for
 * `auto`/`scroll` and stops at the first answer; clipping asks for anything that
 * establishes a bound and collects the whole chain, since visibility is their
 * intersection (what `IntersectionObserver` computes).
 *
 * Within the editor: `nearestScrollContainer` walks up ("what scrolls around
 * me"), `firstScrollableDescendant` walks down ("what scrolls inside me"). Both
 * take the SCRIPT-scrollable predicate — an overlay must re-measure inside a
 * clipping box a user cannot wheel.
 *
 * Out of the editor (the host-scroll seam): `nearestUserScrollableAncestor`
 * answers autoscroll, `clippingAncestors` answers visibility.
 *
 * Not every walk in the codebase lives here yet: `selection/drag-pointer.ts` keeps
 * its own inner walk over the user-scrollable predicate. Sharing that predicate is
 * a known follow-up, so a change to the sets below is not automatically a change
 * to what a drag-select does inside a table.
 */

// Scrollable through script — `element.scrollTop = n` moves it. `hidden` qualifies.
const SCRIPT_SCROLLABLE_VALUES = new Set(['auto', 'scroll', 'hidden']);
// Scrollable by the USER, which is what a drag may autoscroll. A `hidden` box IS
// script-scrollable, and the reveal path does scroll it; it is excluded here by
// convention, not by capability — a user cannot wheel-scroll it back, so a drag
// that autoscrolled it would strand content out of the user's reach.
const USER_SCROLLABLE_VALUES = new Set(['auto', 'scroll']);
// What can bound the visible region. `clip` joins them here and only here: it
// never scrolls, so it is not an autoscroll answer, but a block past its edge is
// unreachable.
const VIEW_BOUNDING_VALUES = new Set([...SCRIPT_SCROLLABLE_VALUES, 'clip']);

function isScriptScrollable(el: HTMLElement): boolean {
	const cs = getComputedStyle(el);
	return SCRIPT_SCROLLABLE_VALUES.has(cs.overflowX) || SCRIPT_SCROLLABLE_VALUES.has(cs.overflowY);
}

// `html`/`body` are never candidates in either walk: when THEY are the scrollport,
// the window viewport is the rect to measure against and the element to scroll, and
// neither of their boxes is that rect.
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

/**
 * The ancestor a drag can autoscroll to bring more of `el` into reach, or null
 * when the page's own viewport is the scrollport. Used in host-scroll mode, where
 * the editor root no longer scrolls itself.
 */
export function nearestUserScrollableAncestor(el: HTMLElement): HTMLElement | null {
	let cur: HTMLElement | null = el.parentElement;
	while (cur && !isPageBox(cur)) {
		const cs = getComputedStyle(cur);
		if (USER_SCROLLABLE_VALUES.has(cs.overflowX) || USER_SCROLLABLE_VALUES.has(cs.overflowY)) {
			return cur;
		}
		cur = cur.parentElement;
	}
	return null;
}

/**
 * Every ancestor that bounds what can be seen of `el`, outermost-last. The whole
 * chain, not the nearest: a card inside a pane inside a scroller each cut the
 * visible region, and only their intersection answers "is this visible" — the
 * innermost match alone is the box a rounded card would answer with, which bounds
 * nothing. Callers intersect the window viewport with these; an empty result means
 * the window alone bounds it.
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

/**
 * First scrollable descendant of `el` in document order, or null. A block-host
 * wrapper sits outside a block's internal scroll container (table's .table-block,
 * code block's contenteditable), so finding what scrolls beneath the host means
 * looking inward, not up.
 */
export function firstScrollableDescendant(el: HTMLElement): HTMLElement | null {
	const stack: HTMLElement[] = [];
	for (const child of el.children) {
		if (child instanceof HTMLElement) stack.push(child);
	}
	while (stack.length > 0) {
		const cur = stack.shift()!;
		if (isScriptScrollable(cur)) return cur;
		for (const child of cur.children) {
			if (child instanceof HTMLElement) stack.push(child);
		}
	}
	return null;
}
