/**
 * Source of truth for "what scrolls" for the selection-overlay re-measure. Two
 * directions for two questions: `nearestScrollContainer` walks up ("what scrolls
 * around me"), `firstScrollableDescendant` walks down ("what scrolls inside me").
 *
 * Qualified: drag autoscroll (`selection/drag-pointer.ts`) walks its own
 * ancestors and counts only `auto`/`scroll`, not `hidden`. So a `hidden`-overflow
 * container is honored here (overlay re-measures against it) but ignored by drag
 * autoscroll. The divergence is deliberate.
 */

const SCROLLABLE_VALUES = new Set(['auto', 'scroll', 'hidden']);

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
