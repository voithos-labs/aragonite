/**
 * What the drawn caret's paint reads off the layout: the caret's box, the block host the bar draws
 * in, and the places where the range's box isn't where the browser paints its own caret (beside a
 * widget, at a soft wrap, clipped by an inner scroller, an engine that paints off a code chip's
 * edge). Reads only; the target decides what to draw from these.
 */

import { firstUsefulRect, neighbourCaretRect, type CaretRect } from './visual-lines';
import { isAtomicInlineWidget, isHiddenMarkerText } from './widget-offset';
import type { HostBox } from './drawn-caret-target';

export interface CaretMeasure {
	host: HTMLElement;
	hostBox: HostBox;
	caret: CaretRect | null;
	/** The caret sits beside an inline widget, where the snap caret draws. */
	besideWidget: boolean;
	/** The caret sits in the run of spaces a line wraps in. */
	atSoftWrap: boolean;
	/** A scroller between the editable and its host clips the caret's box out of view. */
	clipped: boolean;
	/** The engine paints its own caret off the range's box here (WebKit at a code chip's edge). */
	misdrawn: boolean;
}

/** Engine quirks the measure has to know, read once per editor. */
export interface EngineQuirks {
	/** WebKit paints its caret a few pixels off the range's box at an inline code chip's edge. */
	offAtCodeChipEdge: boolean;
}

/** The quirks of the engine this page runs in. Apple's vendor string is WebKit's. */
export function engineQuirks(): EngineQuirks {
	const vendor = (typeof navigator === 'undefined' ? undefined : navigator.vendor) ?? '';
	return { offAtCodeChipEdge: vendor.startsWith('Apple') };
}

export function measureCaret(
	surface: HTMLElement,
	range: Range,
	quirks: EngineQuirks
): CaretMeasure | null {
	const host = surface.closest<HTMLElement>('[data-block-path]') ?? surface.parentElement;
	if (!host) return null;
	const own = firstUsefulRect(range);
	const caret = own ?? neighbourCaretRect(range);
	const box = host.getBoundingClientRect();
	const scale = host.offsetWidth > 0 ? box.width / host.offsetWidth : 1;
	return {
		host,
		hostBox: {
			left: box.left + (host.clientLeft - host.scrollLeft) * scale,
			top: box.top + (host.clientTop - host.scrollTop) * scale,
			scale
		},
		caret: caret && { left: caret.left, top: caret.top, bottom: caret.bottom },
		besideWidget:
			surface.classList.contains(SNAP_CARET_CLASS) || (own === null && touchesWidget(range)),
		atSoftWrap: own !== null && atSoftWrap(range, surface),
		clipped: caret !== null && clippedBetween(surface, host, caret),
		misdrawn: quirks.offAtCodeChipEdge && atCodeChipEdge(range, surface)
	};
}

// ── Internal ────────────────────────────────────────────────────────────────

/** Drawn by the text block beside an inline widget; the bar steps aside while it shows. */
const SNAP_CARET_CLASS = 'md-snap-caret-active';

const WRAP_SPACE = [' ', '\t'];

const CODE_CHIP = '.inline-code-content';

// A line wraps inside a run of spaces, and the range reads one line or the other there whatever
// line the browser draws on; the letters bounding the run sit on different lines exactly then.
function atSoftWrap(range: Range, surface: HTMLElement): boolean {
	const node = range.startContainer;
	if (!(node instanceof Text)) return false;
	const first = letterBox(nearestLetter(node, range.startOffset, surface, false));
	const next = letterBox(nearestLetter(node, range.startOffset, surface, true));
	return first !== null && next !== null && next.top >= first.bottom - 1;
}

/** The nearest letter on one side of `at`, across text nodes inside `surface`, past spaces and the
 *  hidden marker text that paints nothing. */
function nearestLetter(
	start: Text,
	at: number,
	surface: HTMLElement,
	forward: boolean
): { node: Text; at: number } | null {
	const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
	walker.currentNode = start;
	let node: Text | null = start;
	let i = forward ? at : at - 1;
	while (node) {
		if (!isHiddenMarkerText(node, surface)) {
			for (; i >= 0 && i < node.data.length; i += forward ? 1 : -1) {
				if (!WRAP_SPACE.includes(node.data[i])) return { node, at: i };
			}
		}
		node = (forward ? walker.nextNode() : walker.previousNode()) as Text | null;
		if (node) i = forward ? 0 : node.data.length - 1;
	}
	return null;
}

function letterBox(letter: { node: Text; at: number } | null): DOMRect | null {
	if (!letter) return null;
	const range = document.createRange();
	range.setStart(letter.node, letter.at);
	range.setEnd(letter.node, letter.at + 1);
	return firstUsefulRect(range);
}

// The caret at a code chip's first or last letter, or in the text just past the chip.
function atCodeChipEdge(range: Range, surface: HTMLElement): boolean {
	const node = range.startContainer;
	if (!(node instanceof Text)) return false;
	const at = range.startOffset;
	if (node.parentElement?.closest(CODE_CHIP)) return at === 0 || at === node.data.length;
	const before = at === 0 ? nearestLetter(node, 0, surface, false) : null;
	const after = at === node.data.length ? nearestLetter(node, at, surface, true) : null;
	return [before, after].some((letter) => !!letter?.node.parentElement?.closest(CODE_CHIP));
}

// A scroller inside the block (a code block's long lines, a wide cell) clips the browser's caret,
// but not the bar, which sits outside it in the host.
function clippedBetween(surface: HTMLElement, host: HTMLElement, caret: CaretRect): boolean {
	for (let el: HTMLElement | null = surface; el && el !== host; el = el.parentElement) {
		if (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) continue;
		const style = getComputedStyle(el);
		if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
		const box = el.getBoundingClientRect();
		const scale = el.offsetWidth > 0 ? box.width / el.offsetWidth : 1;
		const left = box.left + el.clientLeft * scale;
		const top = box.top + el.clientTop * scale;
		const outside =
			caret.left < left - 1 ||
			caret.left > left + el.clientWidth * scale + 1 ||
			caret.bottom < top ||
			caret.top > top + el.clientHeight * scale;
		if (outside) return true;
	}
	return false;
}

function touchesWidget(range: Range): boolean {
	const kids = range.startContainer.childNodes;
	const at = range.startOffset;
	return [kids[at], kids[at - 1]].some((node) => node !== undefined && isAtomicInlineWidget(node));
}
