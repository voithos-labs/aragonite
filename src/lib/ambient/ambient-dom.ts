/**
 * DOM construction and lookup for the marker span (the "ambient" prefix): the read-only
 * prefix a container block draws in front of its first prose child's text.
 */

import type { AmbientPrefix } from '../block-component';
import { DRAG_ANCHOR_ATTR } from '../components/block-content-selector';
import { domDescendants } from '../cursor/dom-walk';
import { isAtomicInlineWidget, isHiddenMarkerText } from '../cursor/widget-offset';
import { devWarn } from '../dev-warn';

export function buildAmbientSpan(prefix: AmbientPrefix): HTMLSpanElement {
	const normalized = typeof prefix === 'string' ? { text: prefix } : prefix;
	const outer = document.createElement('span');
	outer.className = 'md-marker';
	outer.setAttribute('contenteditable', 'false');

	// Document order, whatever order the host listed them in: the walk below is a single pass.
	const ranges = [...(normalized.interactive ?? [])].sort((a, b) => a.start - b.start);
	let cursor = 0;

	for (const range of ranges) {
		if (range.start < 0 || range.end > normalized.text.length || range.start >= range.end) {
			devWarn('ambient-span', 'interactive range out of bounds or empty', {
				range,
				textLength: normalized.text.length
			});
			continue;
		}
		if (range.start > cursor) {
			outer.appendChild(document.createTextNode(normalized.text.slice(cursor, range.start)));
		}
		const inner = document.createElement('span');
		inner.className = range.className;
		if (range.role) inner.setAttribute('role', range.role);
		if (range.ariaChecked !== undefined) {
			inner.setAttribute('aria-checked', String(range.ariaChecked));
		}
		if (range.label !== undefined) inner.setAttribute('aria-label', range.label);
		if (range.focusable) inner.tabIndex = 0;
		if (range.dragAnchor) inner.setAttribute(DRAG_ANCHOR_ATTR, '');
		inner.textContent = normalized.text.slice(range.start, range.end);
		inner.addEventListener('click', range.onClick);
		const onActivate = range.onActivate;
		if (onActivate) inner.addEventListener('keydown', (e) => activateOnKey(e, onActivate));
		outer.appendChild(inner);
		cursor = range.end;
	}

	if (cursor < normalized.text.length) {
		outer.appendChild(document.createTextNode(normalized.text.slice(cursor)));
	}

	return outer;
}

export function ambientSpanOf(blockEl: ParentNode): HTMLElement | null {
	const first = blockEl.firstChild;
	if (!first || first.nodeType !== Node.ELEMENT_NODE) return null;
	const span = first as HTMLElement;
	if (!span.classList.contains('md-marker')) return null;
	if (span.getAttribute('contenteditable') !== 'false') return null;
	return span;
}

export function ambientLengthOf(blockEl: HTMLElement): number {
	return ambientSpanOf(blockEl)?.textContent?.length ?? 0;
}

export function placeCaretAfterAmbientSpan(blockEl: HTMLElement): boolean {
	const point = pointAfterAmbientSpan(blockEl);
	if (!point) return false;
	const range = document.createRange();
	range.setStart(point.node, point.offset);
	range.collapse(true);
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
	return true;
}

/** Where raw offset 0 sits in the DOM of a block with a marker span; null without one. */
export function pointAfterAmbientSpan(blockEl: HTMLElement): { node: Node; offset: number } | null {
	const span = ambientSpanOf(blockEl);
	if (!span) return null;
	// The first text node after the span has real rects where the spot after the span may not;
	// a hidden marker run there paints nothing, so raw offset 0 must not land in it.
	const textAfter = firstTextNodeAfter(span);
	if (textAfter && !isHiddenMarkerText(textAfter, blockEl)) return { node: textAfter, offset: 0 };
	const parent = span.parentNode!;
	return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, span) + 1 };
}

// ── Internal ────────────────────────────────────────────────────────────────

// Enter and Space, the keys a link or button answers; the block below must not see them too.
function activateOnKey(e: KeyboardEvent, onActivate: () => void): void {
	if (e.key !== 'Enter' && e.key !== ' ') return;
	e.preventDefault();
	e.stopPropagation();
	onActivate();
}

function firstTextNodeAfter(node: Node): Text | null {
	let sibling = node.nextSibling;
	while (sibling) {
		// An atomic widget stands for raw bytes, so text past it is not raw 0.
		if (isAtomicInlineWidget(sibling)) return null;
		const text = firstTextDescendant(sibling);
		if (text) return text;
		sibling = sibling.nextSibling;
	}
	return null;
}

// Unfiltered on the way down, unlike the measurable-text search it resembles
// (`cursor/visual-lines.ts`): the caller judges hidden marker text once, at the top.
function firstTextDescendant(node: Node): Text | null {
	for (const current of domDescendants(node)) {
		if (current.nodeType === Node.TEXT_NODE && (current.textContent?.length ?? 0) > 0) {
			return current as Text;
		}
	}
	return null;
}
