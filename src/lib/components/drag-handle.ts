/**
 * The block drag handle's two policies, kept out of the components that render it: which
 * blocks carry one, and where its grip sits.
 *
 * Presence: a paragraph is the page's background, so it renders no grip. The structural
 * blocks (headings, lists, quotes, cards) do. A paragraph stays a reorder unit either way:
 * keyboard reorder still moves it, and a dragged block can still drop beside it.
 */

import { BLOCK_CONTENT_SELECTOR, DRAG_ANCHOR_ATTR } from './block-content-selector';

const BACKGROUND_KINDS: ReadonlySet<string> = new Set(['paragraph']);

export function showsDragHandle(kind: string): boolean {
	return !BACKGROUND_KINDS.has(kind);
}

/**
 * Vertical centre of the grip, measured rather than assumed from the host's line-height: a
 * heading's line is taller than the host's, a code card pads above its first line, a checkbox
 * is taller than the text beside it. A declared anchor wins unless it sits below the first
 * line (a nested unit's checkbox is not this block's); a CSS-painted title above it is.
 */
export function dragHandleAnchorY(host: HTMLElement): number | null {
	const content = host.querySelector<HTMLElement>(BLOCK_CONTENT_SELECTOR);
	if (!content) return null;
	const line = firstLineRect(content);
	const declared = content.matches(`[${DRAG_ANCHOR_ATTR}]`)
		? content
		: content.querySelector(`[${DRAG_ANCHOR_ATTR}]`);
	const declaredRect = declared?.getBoundingClientRect();
	const rect = pickAnchor(declaredRect, line);
	if (!rect) return null;
	const hostRect = host.getBoundingClientRect();
	const y = rect.top + rect.height / 2 - hostRect.top;
	// A first text node can paint outside the host (a scrolled or offscreen region): no seat.
	return y >= 0 && y <= hostRect.height ? y : null;
}

function pickAnchor(declared: DOMRect | undefined, line: DOMRect | null): DOMRect | null {
	if (declared && declared.height > 0 && (!line || declared.top < line.bottom)) return declared;
	return line;
}

/** The first painted rect of the first non-blank text node, or of an empty line's `<br>`
 *  (an untitled chrome leaf, a bare heading): hidden markers paint none. */
function firstLineRect(content: HTMLElement): DOMRect | null {
	const walker = document.createTreeWalker(
		content,
		NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
		{
			acceptNode: (n) => {
				if (n instanceof HTMLBRElement) return NodeFilter.FILTER_ACCEPT;
				if (n.nodeType !== Node.TEXT_NODE) return NodeFilter.FILTER_SKIP;
				return (n.textContent ?? '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
			}
		}
	);
	const range = document.createRange();
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		let rects: DOMRectList;
		if (node instanceof HTMLBRElement) rects = node.getClientRects();
		else {
			range.selectNodeContents(node);
			rects = range.getClientRects();
		}
		for (const r of rects) {
			if (r.height > 0) return r;
		}
	}
	return null;
}

/**
 * Svelte attachment for the handle element: re-measures on every pointerover inside its host,
 * so the grip is placed by the time the hover rule reveals it and follows edits made while
 * hovered. Layout is clean during a hover, so the reads are cheap; touch, which never hovers,
 * keeps the stylesheet's first-line default.
 */
export function alignDragHandle(handle: HTMLElement): (() => void) | void {
	const host = handle.parentElement;
	if (!host) return;
	const grip = handle.firstElementChild as HTMLElement | null;
	if (!grip) return;
	// Inline `top` on the grip (px from the host's top to its centre; the stylesheet's
	// translateY(-50%) does the centring) overrides the stylesheet's half-line default.
	const place = () => {
		const y = dragHandleAnchorY(host);
		if (y !== null) grip.style.top = `${y}px`;
	};
	host.addEventListener('pointerover', place);
	return () => host.removeEventListener('pointerover', place);
}
