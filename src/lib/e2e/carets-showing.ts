/**
 * What caret a user sees right now, read off the page: the browser's own caret in the focused
 * editable, and every caret the editor draws (the drawn caret's bar, or the snap caret beside a
 * widget). Every row about the drawn caret asserts exactly one of them shows.
 */

import type { Page } from '@playwright/test';

export interface CaretsShowing {
	/** The focused editable holds a collapsed selection and paints the browser's caret. */
	native: boolean;
	/** Carets the editor paints itself. */
	drawn: number;
}

export function caretsShowing(page: Page): Promise<CaretsShowing> {
	return page.evaluate(() => {
		const active = document.activeElement as HTMLElement | null;
		const sel = window.getSelection();
		const field = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
		const collapsed = field
			? active.selectionStart === active.selectionEnd
			: !!active?.isContentEditable &&
				!!sel &&
				sel.rangeCount > 0 &&
				sel.isCollapsed &&
				active.contains(sel.anchorNode);
		const color = active ? getComputedStyle(active).caretColor : '';
		const native =
			document.hasFocus() && collapsed && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)';
		const bars = [...document.querySelectorAll<HTMLElement>('.md-drawn-caret')].filter(
			(bar) => bar.dataset.caretState === 'text' && getComputedStyle(bar).display !== 'none'
		).length;
		const snaps = document.querySelectorAll(
			'.md-snap-caret-active .md-snap-after, .md-snap-caret-active .md-snap-before'
		).length;
		return { native, drawn: bars + snaps };
	});
}

/** A caret's box in client pixels. */
export interface CaretBox {
	left: number;
	top: number;
	height: number;
}

/** The drawn caret's bar, or null while it draws nothing. */
export function drawnCaretBox(page: Page): Promise<CaretBox | null> {
	return page.evaluate(() => {
		const bar = document.querySelector<HTMLElement>('.md-drawn-caret[data-caret-state="text"]');
		if (!bar) return null;
		const r = bar.getBoundingClientRect();
		return { left: r.left, top: r.top, height: r.height };
	});
}

/** The live collapsed range's box: its first rect with height, else the box of the node it sits
 *  against, the way a caret beside a line break or an empty block measures. */
export function nativeCaretBox(page: Page): Promise<CaretBox | null> {
	return page.evaluate(() => {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
		const range = sel.getRangeAt(0);
		const rects = range.getClientRects();
		const own = rects.length > 0 && rects[0].height > 0 ? rects[0] : range.getBoundingClientRect();
		if (own.height > 0) return { left: own.left, top: own.top, height: own.height };
		const container = range.startContainer;
		if (container.nodeType !== Node.ELEMENT_NODE) return null;
		const boxOf = (node: Node | undefined, fromEnd: boolean) => {
			if (!node) return null;
			const around = document.createRange();
			around.selectNode(node);
			const all = around.getClientRects();
			const r =
				all.length === 0 ? around.getBoundingClientRect() : all[fromEnd ? all.length - 1 : 0];
			return r.height > 0
				? { left: fromEnd ? r.right : r.left, top: r.top, height: r.height }
				: null;
		};
		const kids = container.childNodes;
		return boxOf(kids[range.startOffset], false) ?? boxOf(kids[range.startOffset - 1], true);
	});
}
