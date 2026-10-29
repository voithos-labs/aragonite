/**
 * Whether a collapsed caret at a DOM position shows, read from what sits beside it: visible text
 * or a `<br>` gives the browser a line to paint on, and so does an inline widget. Beside a picture
 * (a widget whose kind declares `frame`) the drawn caret's bar shows it instead.
 */

import { domTextOffsetAtNode, type DomPosition } from './offsets';
import { FRAME_ATTR } from '../core/inline/widget-shell';
import {
	isAtomicInlineWidget,
	isHiddenMarkerRoot,
	isHiddenMarkerText,
	landingSegments,
	markerHidingMode,
	markerRootOf
} from './painted';

/** What draws a caret at a spot: the browser, beside text, a line or a widget; or nothing. */
export type CaretSpot = 'text' | 'line' | 'widget' | 'none';

/** How a collapsed caret at `at` in the editable `el` shows. A text position outside marker spans
 *  reads no style and walks nothing, so a caret in plain text pays one climb to `el`. */
export function caretSpotOf(el: HTMLElement, at: DomPosition): CaretSpot {
	if (at.node.nodeType === Node.TEXT_NODE) {
		return markerRootOf(at.node, el) && isHiddenMarkerText(at.node, el) ? 'none' : 'text';
	}
	const before = besideSpot(el, at, 'before');
	const after = besideSpot(el, at, 'after');
	for (const spot of SPOT_ORDER) if (before.spot === spot || after.spot === spot) return spot;
	// An editable holding nothing still has the line its own box gives it.
	return before.skippedHidden || after.skippedHidden ? 'none' : 'line';
}

/** The widgets on each side of an element-level position, past empty text and hidden marker runs:
 *  what a caret there sits beside. A text position sits beside none. */
export function widgetsBeside(el: HTMLElement, at: DomPosition): HTMLElement[] {
	if (at.node.nodeType === Node.TEXT_NODE) return [];
	const found: HTMLElement[] = [];
	for (const side of ['before', 'after'] as const) {
		const { widget } = besideSpot(el, at, side);
		if (widget) found.push(widget);
	}
	return found;
}

/** The picture a caret at `at` sits beside, and which of its edges: the one before the caret
 *  first, since a letter typed between two lands after the first. Null in text or beside none. */
export function frameBeside(
	el: HTMLElement,
	at: DomPosition
): { frame: HTMLElement; side: 'before' | 'after' } | null {
	if (at.node.nodeType === Node.TEXT_NODE) return null;
	const before = besideSpot(el, at, 'before').widget;
	if (before?.hasAttribute(FRAME_ATTR)) return { frame: before, side: 'after' };
	const after = besideSpot(el, at, 'after').widget;
	if (after?.hasAttribute(FRAME_ATTR)) return { frame: after, side: 'before' };
	return null;
}

/** A position for the same walk offset as `at` that sits in visible text, or null: the end of the
 *  text before it, else the start of the text after it. */
export function visibleTextAtSameOffset(el: HTMLElement, at: DomPosition): DomPosition | null {
	const walk = domTextOffsetAtNode(el, at.node, at.offset);
	let start: DomPosition | null = null;
	for (const seg of landingSegments(el, markerHidingMode(el))) {
		if (seg.start > walk) break;
		if (seg.kind !== 'text' || seg.len === 0) continue;
		if (seg.start + seg.len === walk) return { node: seg.node, offset: seg.len };
		if (seg.start === walk) start ??= { node: seg.node, offset: 0 };
	}
	return start;
}

// ── Internal ────────────────────────────────────────────────────────────────

// Strongest first: a painted line beside the spot wins over a widget.
const SPOT_ORDER: CaretSpot[] = ['line', 'widget'];

type Side = 'before' | 'after';

interface Beside {
	spot: CaretSpot | null;
	widget: HTMLElement | null;
	skippedHidden: boolean;
}

/** The first thing on `side` of an element-level position that paints, past empty text and hidden
 *  marker runs, without leaving `el`. */
function besideSpot(el: HTMLElement, at: DomPosition, side: Side): Beside {
	let skippedHidden = false;
	const children = at.node.childNodes;
	let node: Node | null =
		(side === 'after' ? children[at.offset] : children[at.offset - 1]) ??
		stepOut(at.node, side, el);
	while (node) {
		if (node.nodeType === Node.TEXT_NODE) {
			if ((node.textContent ?? '') === '') {
				node = stepOut(node, side, el);
				continue;
			}
			if (isHiddenMarkerText(node, el)) {
				skippedHidden = true;
				node = stepOut(node, side, el);
				continue;
			}
			return { spot: 'line', widget: null, skippedHidden };
		}
		if (!(node instanceof Element)) {
			node = stepOut(node, side, el);
			continue;
		}
		if (isAtomicInlineWidget(node)) {
			return { spot: 'widget', widget: node as HTMLElement, skippedHidden };
		}
		if (node.tagName === 'BR') return { spot: 'line', widget: null, skippedHidden };
		if (isHiddenMarkerRoot(node, el)) {
			skippedHidden = true;
			node = stepOut(node, side, el);
			continue;
		}
		node = (side === 'after' ? node.firstChild : node.lastChild) ?? stepOut(node, side, el);
	}
	return { spot: null, widget: null, skippedHidden };
}

/** The node past `node` on `side`, climbing out of parents but never out of `root`. */
function stepOut(node: Node, side: Side, root: Node): Node | null {
	for (let at: Node | null = node; at && at !== root; at = at.parentNode) {
		const sibling = side === 'after' ? at.nextSibling : at.previousSibling;
		if (sibling) return sibling;
	}
	return null;
}
