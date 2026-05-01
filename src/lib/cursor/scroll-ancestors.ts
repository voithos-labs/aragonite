/**
 * Single source of truth for "what scrolls." Used by drag-pointer (walks up
 * from pointer-current element) and SelectionOverlay (walks down from the
 * block-host wrapper into the rendered content). Different lookup directions
 * because the consumers' contexts differ — drag-pointer asks "what scrolls
 * around me," overlay asks "what scrolls inside me."
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
 * First scrollable descendant of `el` in document order, or null. Used by the
 * selection overlay: the block-host wrapper sits outside a block's internal
 * scroll container (table's .table-block, code block's contenteditable), so
 * the overlay must look inward to find what scrolls beneath it.
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
