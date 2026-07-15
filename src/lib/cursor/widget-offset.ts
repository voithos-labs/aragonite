/**
 * DOM Range ↔ walk-space offset translation for atomic inline widgets.
 * Widgets contribute their raw bytes via data-source-start / data-source-end
 * without contributing to textContent; the walker accumulates text-node
 * lengths — including a leading ambient marker span's text — plus widget raw
 * lengths. Walk positions are therefore `DomTextOffset` (raw + ambient prefix);
 * `ambient/ambient-cursor.ts` owns the ± ambientLength translation to raw.
 */

import { asDomTextOffset, type DomTextOffset } from './coordinate-spaces';

const WIDGET_SELECTOR = '[data-inline-widget]';

export function rawOffsetAtNode(container: HTMLElement, node: Node, offset: number): DomTextOffset {
	let count = 0;
	let stopped = false;

	function visit(current: Node): boolean {
		if (stopped) return true;
		if (current === node) {
			if (current.nodeType === Node.TEXT_NODE) {
				count += offset;
			} else {
				const cap = Math.min(offset, current.childNodes.length);
				for (let i = 0; i < cap; i++) {
					if (visit(current.childNodes[i])) return true;
				}
			}
			stopped = true;
			return true;
		}
		if (current.nodeType === Node.TEXT_NODE) {
			count += current.textContent?.length ?? 0;
			return false;
		}
		if (current.nodeType === Node.ELEMENT_NODE) {
			const el = current as Element;
			if (el.matches?.(WIDGET_SELECTOR)) {
				count += widgetRawLength(el);
				return false;
			}
			for (const child of current.childNodes) {
				if (visit(child)) return true;
			}
		}
		return false;
	}

	visit(container);
	return asDomTextOffset(count);
}

export interface DomPosition {
	node: Node;
	offset: number;
}

/**
 * DOM-layer lookup: maps a walk-space offset to a live `(node, offset)` DOM
 * position. The model-layer counterpart is `core/inline-render.ts`
 * `findNodeAtOffset`, which maps the same offset to a CST inline node without
 * touching the DOM. Accepts a detached fragment (island application walks
 * builds in progress) with the same arithmetic as a live block element.
 */
export function findRawOffsetTarget(
	container: ParentNode,
	target: DomTextOffset
): DomPosition | null {
	let count = 0;
	let last: DomPosition | null = null;

	function visit(current: Node): DomPosition | null {
		if (current.nodeType === Node.TEXT_NODE) {
			const len = current.textContent?.length ?? 0;
			if (count + len >= target) {
				return { node: current, offset: target - count };
			}
			count += len;
			last = { node: current, offset: len };
			return null;
		}
		if (current.nodeType === Node.ELEMENT_NODE) {
			const el = current as Element;
			if (el.matches?.(WIDGET_SELECTOR)) {
				const len = widgetRawLength(el);
				const parent = el.parentNode;
				const idx = parent ? Array.prototype.indexOf.call(parent.childNodes, el) : 0;
				// Prefer landing in an adjacent text node — Chromium drops beforeinput
				// at element-level offsets between two contenteditable=false islands.
				if (count === target && parent) {
					const prev = el.previousSibling;
					if (prev && prev.nodeType === Node.TEXT_NODE) {
						return { node: prev, offset: prev.textContent?.length ?? 0 };
					}
					return { node: parent, offset: idx };
				}
				if (count + len >= target && parent) {
					const next = el.nextSibling;
					if (next && next.nodeType === Node.TEXT_NODE) {
						return { node: next, offset: 0 };
					}
					return { node: parent, offset: idx + 1 };
				}
				count += len;
				if (parent) last = { node: parent, offset: idx + 1 };
				return null;
			}
			for (const child of current.childNodes) {
				const result = visit(child);
				if (result) return result;
			}
		}
		return null;
	}

	// Iterate children rather than visiting `container` itself: a fragment root
	// matches neither node-type branch, and the container is never a widget.
	for (const child of container.childNodes) {
		const found = visit(child);
		if (found) return found;
	}
	return last;
}

/**
 * Atomic inline widgets in `container` whose raw source range intersects
 * [start, end). A widget contributes 0 chars to textContent, so a range lying
 * entirely inside one collapses to zero width via `createRangeAtRawOffsets` and
 * yields no client rect; callers that must cover the widget (search highlight,
 * cross-block selection) take its bounding box instead. Offsets are the same
 * ambient-included raw positions `findRawOffsetTarget` walks — text-node lengths
 * (including marker-span text) plus widget raw lengths — so a widget's position
 * is the running walk offset, not a naive compare of `data-source-*` against the
 * ambient-adjusted argument.
 */
export function widgetsIntersectingRange(
	container: HTMLElement,
	start: DomTextOffset,
	end: DomTextOffset
): HTMLElement[] {
	const out: HTMLElement[] = [];
	let count = 0;
	function visit(current: Node): void {
		if (current.nodeType === Node.TEXT_NODE) {
			count += current.textContent?.length ?? 0;
			return;
		}
		if (current.nodeType === Node.ELEMENT_NODE) {
			const el = current as Element;
			if (el.matches?.(WIDGET_SELECTOR)) {
				const len = widgetRawLength(el);
				// Half-open intersection of the widget span [count, count+len) with
				// the requested [start, end). A zero-length widget can't be covered.
				if (len > 0 && count < end && start < count + len) {
					out.push(el as HTMLElement);
				}
				count += len;
				return;
			}
			for (const child of current.childNodes) visit(child);
		}
	}
	visit(container);
	return out;
}

/** Total walk length of `container` — its one-past-end walk position. */
export function containerRawLength(container: ParentNode): DomTextOffset {
	let count = 0;
	function visit(node: Node): void {
		if (node.nodeType === Node.TEXT_NODE) {
			count += node.textContent?.length ?? 0;
			return;
		}
		if (node.nodeType === Node.ELEMENT_NODE) {
			const el = node as Element;
			if (el.matches?.(WIDGET_SELECTOR)) {
				count += widgetRawLength(el);
				return;
			}
			for (const child of node.childNodes) visit(child);
		}
	}
	for (const child of container.childNodes) visit(child);
	return asDomTextOffset(count);
}

/**
 * Walk-space span of the atomic widget strictly containing `offset`, or null
 * when the offset sits in text or exactly on a widget boundary. Island
 * application snaps replace boundaries outward with this — a text-position
 * range cannot split an atomic widget.
 */
export function widgetSpanContainingOffset(
	container: ParentNode,
	offset: DomTextOffset
): { start: DomTextOffset; end: DomTextOffset } | null {
	let count = 0;
	let found: { start: DomTextOffset; end: DomTextOffset } | null = null;
	function visit(node: Node): void {
		if (found || count > offset) return;
		if (node.nodeType === Node.TEXT_NODE) {
			count += node.textContent?.length ?? 0;
			return;
		}
		if (node.nodeType === Node.ELEMENT_NODE) {
			const el = node as Element;
			if (el.matches?.(WIDGET_SELECTOR)) {
				const len = widgetRawLength(el);
				if (len > 0 && count < offset && offset < count + len) {
					found = { start: asDomTextOffset(count), end: asDomTextOffset(count + len) };
				}
				count += len;
				return;
			}
			for (const child of node.childNodes) visit(child);
		}
	}
	for (const child of container.childNodes) visit(child);
	return found;
}

/** Raw bytes a DOM subtree stands for: text nodes verbatim, widgets via their source range. */
export function rawTextOfNode(domNode: Node, raw: string): string {
	if (domNode.nodeType === Node.TEXT_NODE) return domNode.textContent ?? '';
	if (domNode.nodeType === Node.ELEMENT_NODE) {
		const el = domNode as Element;
		if (el.matches?.(WIDGET_SELECTOR)) {
			const range = readWidgetSourceRange(el);
			return range ? raw.slice(range.start, range.end) : '';
		}
		let out = '';
		for (const child of Array.from(el.childNodes)) out += rawTextOfNode(child, raw);
		return out;
	}
	if (domNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
		let out = '';
		for (const child of Array.from(domNode.childNodes)) out += rawTextOfNode(child, raw);
		return out;
	}
	return '';
}

export function createRangeAtRawOffsets(
	container: ParentNode,
	start: DomTextOffset,
	end: DomTextOffset
): Range | null {
	const range = document.createRange();
	// A detached fragment has no parent for setEndAfter; end inside it instead.
	const setEndAtContainerEnd = () => {
		if (container instanceof Element) range.setEndAfter(container);
		else range.setEnd(container, container.childNodes.length);
	};
	const startPos = findRawOffsetTarget(container, start);
	if (!startPos) {
		range.selectNodeContents(container);
		range.collapse(false);
		return range;
	}
	try {
		range.setStart(startPos.node, startPos.offset);
	} catch {
		return null;
	}
	if (start === end) {
		range.collapse(true);
		return range;
	}
	const endPos = findRawOffsetTarget(container, end);
	if (endPos) {
		try {
			range.setEnd(endPos.node, endPos.offset);
		} catch {
			setEndAtContainerEnd();
		}
	} else {
		setEndAtContainerEnd();
	}
	return range;
}

function widgetRawLength(el: Element): number {
	const range = readWidgetSourceRange(el);
	return range ? Math.max(0, range.end - range.start) : 0;
}

/** Widget raw byte range from data-source-* attributes; null when malformed. */
function readWidgetSourceRange(el: Element): { start: number; end: number } | null {
	const start = parseInt(el.getAttribute('data-source-start') ?? '', 10);
	const end = parseInt(el.getAttribute('data-source-end') ?? '', 10);
	if (Number.isNaN(start) || Number.isNaN(end)) return null;
	return { start, end };
}
