/**
 * The block drag handle's two rules: which blocks get one (the objects a user picks up whole,
 * never prose, as `schema/page-role.ts` tells them apart), and where it sits. A block without
 * one still reorders by keyboard.
 */

import type { NodeView } from '../core/node-views';
import { isImageOnlyParagraph } from '../core/inline/picture';
import type { InlineReading } from '../core/inline/inline-cache';
import { blockPageRole } from '../schema/page-role';
import { BLOCK_CONTENT_SELECTOR, DRAG_ANCHOR_ATTR } from './block-content-selector';

/**
 * A picture's handle does not wait for `blockDragHandles`: dragging it is the only way to move
 * a picture with the pointer, and unlike prose it is a separate object a user expects to pick
 * up. The caller still checks reading mode, which shows no such controls at all.
 */
export function showsDragHandle(
	node: NodeView,
	handlesEnabled: boolean,
	reading: InlineReading
): boolean {
	if (isImageOnlyParagraph(node, reading)) return true;
	return handlesEnabled && blockPageRole(node, reading) === 'object';
}

/**
 * A list item's handle reorders it among its siblings and nowhere else: the drag stays inside
 * the enclosing list, so a lone item has nothing to trade places with and its handle promises
 * what the drop cannot deliver. It comes back the moment a second item joins the list.
 */
export function showsListItemDragHandle(itemCount: number, handlesEnabled: boolean): boolean {
	return handlesEnabled && itemCount > 1;
}

/** A box within this many line-heights holds one row of content, margins included. */
const SINGLE_LINE = 1.5;

/**
 * Vertical centre of the handle. A one-line block centres on its row. A taller one uses the
 * first line-height of its own box, not its first line of text, since a card pads above that
 * and a handle level with the first code line hangs below the card's top. A declared anchor
 * element shorter than a line is a marker to centre on instead (a wrapped task item's
 * checkbox); a taller one is a card, which the first line-height already covers.
 */
export function dragHandleAnchorY(host: HTMLElement): number | null {
	const content = host.querySelector<HTMLElement>(BLOCK_CONTENT_SELECTOR);
	if (!content) return null;
	const hostRect = host.getBoundingClientRect();
	const line = lineHeightOf(content);
	const rect = paintedRect(content);
	// A one-line block is its own row, and the eye puts the handle level with it rather than
	// a hair above the middle: a list item, a task row, a rule.
	const box =
		rect.height <= line * SINGLE_LINE ? rect : (markerRect(content, line) ?? bandRect(rect, line));
	if (!box || box.height === 0) return null;
	const y = box.top + box.height / 2 - hostRect.top;
	// A box painted outside the host (a scrolled or offscreen region) places nothing.
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
 * The box measured from: the content's own, unless it starts with an inline widget the caret
 * cannot enter (a picture in a paragraph), whose margin would otherwise put the handle above
 * the picture, level with its corner.
 */
function paintedRect(content: HTMLElement): DOMRect {
	const rect = content.getBoundingClientRect();
	const widget = content.firstElementChild?.closest('[data-inline-widget]');
	const widgetRect = widget?.getBoundingClientRect();
	return widgetRect && widgetRect.height > 0 && widgetRect.top > rect.top ? widgetRect : rect;
}

/** The top line-height of a box; a box shorter than a line is all of it. */
function bandRect(rect: DOMRect, line: number): DOMRect {
	return new DOMRect(rect.x, rect.y, rect.width, Math.min(line, rect.height));
}

/**
 * Svelte attachment for the handle element: places the handle once the block has laid out, so
 * its click target is where it paints before any hover, and again on every pointerover inside
 * its host, so it follows edits made while hovered.
 */
export function alignDragHandle(handle: HTMLElement): (() => void) | void {
	const host = handle.parentElement;
	if (!host) return;
	const grip = handle.firstElementChild as HTMLElement | null;
	if (!grip) return;
	// Inline `top` on the handle (pixels from the host's top to its centre; the stylesheet's
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
