/**
 * Source of truth for "what scrolls". Three questions:
 * `nearestScrollContainer` walks up within the editor ("what scrolls around me"),
 * `firstScrollableDescendant` walks down ("what scrolls inside me"), and
 * `nearestScrollHost` walks up OUT of the editor ("what scrolls the editor
 * itself") — the host-scroll seam.
 *
 * Qualified: drag autoscroll (`selection/drag-pointer.ts`) walks its own
 * ancestors and counts only `auto`/`scroll`, not `hidden`. So a `hidden`-overflow
 * container is honored here (overlay re-measures against it) but ignored by drag
 * autoscroll. The divergence is deliberate.
 */

const SCROLLABLE_VALUES = new Set(['auto', 'scroll', 'hidden']);
// `clip` joins them for the host walk alone: it cannot scroll, but it bounds what
// is visible, and the one caller that asks "is this block in view" must not
// disagree with the one that asks "what do I scroll" about which ancestor owns
// the box. A clip host answers both honestly — nothing is reachable past its edge.
const VIEW_BOUNDING_VALUES = new Set([...SCROLLABLE_VALUES, 'clip']);

function isScrollable(el: HTMLElement): boolean {
	const cs = getComputedStyle(el);
	return SCROLLABLE_VALUES.has(cs.overflowX) || SCROLLABLE_VALUES.has(cs.overflowY);
}

export function nearestScrollContainer(el: HTMLElement, stopAt: HTMLElement): HTMLElement | null {
	let cur: HTMLElement | null = el.parentElement;
	while (cur && cur !== stopAt) {
		if (isScrollable(cur)) return cur;
		cur = cur.parentElement;
	}
	return null;
}

/**
 * The ancestor that scrolls or clips `el` from OUTSIDE it, or null when the page's
 * own viewport is what bounds it. `html`/`body` are not candidates: when they are
 * the scrollport, the window viewport is the rect to measure against, which the
 * null answers for. Used in host-scroll mode, where the editor root itself no
 * longer scrolls and every "what scrolls / what bounds this editor" question has
 * to resolve outward.
 */
export function nearestScrollHost(el: HTMLElement): HTMLElement | null {
	let cur: HTMLElement | null = el.parentElement;
	while (cur && cur !== document.body && cur !== document.documentElement) {
		const cs = getComputedStyle(cur);
		if (VIEW_BOUNDING_VALUES.has(cs.overflowX) || VIEW_BOUNDING_VALUES.has(cs.overflowY)) {
			return cur;
		}
		cur = cur.parentElement;
	}
	return null;
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
		if (isScrollable(cur)) return cur;
		for (const child of cur.children) {
			if (child instanceof HTMLElement) stack.push(child);
		}
	}
	return null;
}
