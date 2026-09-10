/**
 * The block drag handle's two policies, kept out of the components that render it: which
 * blocks carry one, and where its grip sits.
 *
 * Presence: prose carries none. A paragraph, a heading, a quote and the note cards read as
 * text on the page, and a grip beside every one of them is noise; the blocks that get one are
 * the objects a reader picks up whole — pictures, code, tables, equations, diagrams, list
 * items, dividers. A gripless block is still a reorder unit: keyboard reorder moves it and a
 * dragged block still drops beside it.
 */

import type { NodeView } from '../core/node-views';
import { BLOCK_CONTENT_SELECTOR, DRAG_ANCHOR_ATTR } from './block-content-selector';

/**
 * Prose — the page's background and its asides — plus the list SHELL, whose own grip would
 * land in the gutter on top of its first item's and take the hit test with it. A list moves
 * an item at a time; the shell is a wrapper, not a thing to pick up.
 */
const GRIPLESS_KINDS: ReadonlySet<string> = new Set([
	'paragraph',
	'heading',
	'blockquote',
	'admonition',
	'githubAlert',
	'list'
]);

/**
 * A paragraph holding nothing but images is a picture in the page, not prose: it reads as a
 * block of its own and is exactly the thing a reader reaches to move. A false negative here
 * (an alt with an escaped bracket, an image beside a word) is the plain no-grip paragraph.
 */
const IMAGE_ONLY_PARAGRAPH = /^\s*(?:!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])\s*)+$/;

export function isImageOnlyParagraph(node: NodeView): boolean {
	return node.kind === 'paragraph' && IMAGE_ONLY_PARAGRAPH.test(node.raw);
}

/**
 * A picture's grip does NOT wait for `blockDragHandles`: dragging it is the only pointer road
 * to move a picture, and unlike prose it is a discrete object a reader expects to pick up. The
 * caller still gates reading mode, which shows no affordances at all.
 */
export function showsDragHandle(node: NodeView, handlesEnabled: boolean): boolean {
	if (isImageOnlyParagraph(node)) return true;
	return handlesEnabled && !GRIPLESS_KINDS.has(node.kind);
}

/**
 * Vertical centre of the grip: the first line-height of the block's OWN box, measured rather
 * than derived from the host's line-height. Not the first line of text — a card pads above it,
 * and a grip level with the first code line hangs well below the card's shoulder. A declared
 * anchor SHORTER than a line is a marker to centre on instead (a task item's checkbox, which
 * is taller than the text beside it); a taller one is a card, and the band already covers it.
 */
export function dragHandleAnchorY(host: HTMLElement): number | null {
	const content = host.querySelector<HTMLElement>(BLOCK_CONTENT_SELECTOR);
	if (!content) return null;
	const hostRect = host.getBoundingClientRect();
	const line = lineHeightOf(content);
	const marker = markerRect(content, line);
	const box = marker ?? bandRect(paintedRect(content), line);
	if (!box || box.height === 0) return null;
	const y = box.top + box.height / 2 - hostRect.top;
	// A box painting outside the host (a scrolled or offscreen region) seats nothing.
	return y >= 0 && y <= hostRect.height ? y : null;
}

function lineHeightOf(content: HTMLElement): number {
	const line = parseFloat(getComputedStyle(content).lineHeight);
	return Number.isFinite(line) && line > 0 ? line : 20;
}

/** The declared anchor, taken only while it is marker-sized and on the block's first line. */
function markerRect(content: HTMLElement, line: number): DOMRect | null {
	const declared = content.matches(`[${DRAG_ANCHOR_ATTR}]`)
		? content
		: content.querySelector<HTMLElement>(`[${DRAG_ANCHOR_ATTR}]`);
	const rect = declared?.getBoundingClientRect();
	if (!rect || rect.height === 0 || rect.height > line) return null;
	return rect.top - content.getBoundingClientRect().top > line ? null : rect;
}

/**
 * The box the band measures from: the content's own, unless it leads with an atomic widget
 * (a picture in a paragraph), whose margin would otherwise seat the grip above the picture and
 * flush with its corner.
 */
function paintedRect(content: HTMLElement): DOMRect {
	const rect = content.getBoundingClientRect();
	const widget = content.firstElementChild?.closest('[data-inline-widget]');
	const widgetRect = widget?.getBoundingClientRect();
	return widgetRect && widgetRect.height > 0 && widgetRect.top > rect.top ? widgetRect : rect;
}

/** The top line-height of a box; a box shorter than a line is its own band. */
function bandRect(rect: DOMRect, line: number): DOMRect {
	return new DOMRect(rect.x, rect.y, rect.width, Math.min(line, rect.height));
}

/**
 * Svelte attachment for the handle element: places the grip once the block has laid out, and
 * again on every pointerover inside its host, so it follows edits made while hovered.
 *
 * The mount placement is what makes the grip HITTABLE where it appears: it is its own hit
 * target before any hover, so a target parked at the stylesheet's default while the grip would
 * settle elsewhere is a target the pointer misses. One rAF-batched read per handle.
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
	const settled = requestAnimationFrame(place);
	host.addEventListener('pointerover', place);
	return () => {
		cancelAnimationFrame(settled);
		host.removeEventListener('pointerover', place);
	};
}
