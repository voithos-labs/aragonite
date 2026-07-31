/**
 * The single DOM Range ↔ raw offset translation point (`docs/design/editor.md`). Atomic
 * inline widgets contribute their raw bytes via data-source-start / data-source-end
 * without contributing to textContent; the walk sums text-node lengths — a leading
 * ambient marker span's text included — plus widget raw lengths, so walk positions are
 * `DomTextOffset` and `ambient/ambient-cursor.ts` owns the ± ambientLength step to raw.
 */

import { asDomTextOffset, type DomTextOffset } from './coordinate-spaces';

const WIDGET_SELECTOR = '[data-inline-widget]';

/**
 * Walk-space offset of a live `(node, offset)` DOM position. A position inside an atomic
 * widget snaps to that widget's own walk boundary (browsers do rebind carets into these
 * contenteditable=false islands); an unreachable one reads as end-of-walk, so callers that
 * must distinguish "not mine" guard containment first.
 */
export function domTextOffsetAtNode(
	container: HTMLElement,
	node: Node,
	offset: number
): DomTextOffset {
	// No landmark outside the container: document order against a disconnected tree is
	// implementation-specific, so such a position reads as end-of-walk instead.
	const boundary = container.contains(node) ? positionBoundary(node, offset) : null;
	let total = 0;
	for (const seg of walkSegments(container)) {
		const segNode = seg.kind === 'text' ? seg.node : seg.el;
		if (seg.kind === 'widget' && seg.el.contains(node)) {
			return asDomTextOffset(offset === 0 ? seg.start : seg.start + seg.len);
		}
		if (segNode === node) return asDomTextOffset(seg.start + offset);
		if (boundary && startsAtOrAfter(segNode, boundary)) return asDomTextOffset(seg.start);
		total = seg.start + seg.len;
	}
	return asDomTextOffset(total);
}

export interface DomPosition {
	node: Node;
	offset: number;
}

/**
 * Walk-space offset → live `(node, offset)` DOM position. The model-layer counterpart is
 * `findNodeAtOffset` in `core/inline-render.ts`. Accepts a detached fragment (island
 * application walks builds in progress) with the same arithmetic as a live block element.
 */
export function findDomTextOffsetTarget(
	container: ParentNode,
	target: DomTextOffset
): DomPosition | null {
	let last: DomPosition | null = null;
	for (const seg of walkSegments(container)) {
		if (seg.kind === 'text') {
			if (seg.start + seg.len >= target) return { node: seg.node, offset: target - seg.start };
			last = { node: seg.node, offset: seg.len };
			continue;
		}
		const { el, start, len } = seg;
		const parent = el.parentNode;
		const idx = parent ? Array.prototype.indexOf.call(parent.childNodes, el) : 0;
		// Prefer landing in an adjacent text node — Chromium drops beforeinput
		// at element-level offsets between two contenteditable=false islands.
		if (start === target && parent) {
			const prev = el.previousSibling;
			if (prev && prev.nodeType === Node.TEXT_NODE) {
				return { node: prev, offset: prev.textContent?.length ?? 0 };
			}
			return { node: parent, offset: idx };
		}
		if (start + len >= target && parent) {
			const next = el.nextSibling;
			if (next && next.nodeType === Node.TEXT_NODE) return { node: next, offset: 0 };
			return { node: parent, offset: idx + 1 };
		}
		if (parent) last = { node: parent, offset: idx + 1 };
	}
	return last;
}

/**
 * Atomic inline widgets in `container` intersecting the walk-space range [start, end). A
 * widget adds 0 chars to textContent, so a range inside one yields no client rect and
 * callers that must cover it (search highlight, cross-block selection) take its bounding
 * box. A widget's position is its running walk offset, never a compare of `data-source-*`
 * against the ambient-adjusted argument.
 */
export function widgetsIntersectingRange(
	container: HTMLElement,
	start: DomTextOffset,
	end: DomTextOffset
): HTMLElement[] {
	const out: HTMLElement[] = [];
	for (const seg of walkSegments(container)) {
		// Half-open overlap; a zero-length widget can't be covered.
		if (seg.kind === 'widget' && seg.len > 0 && seg.start < end && start < seg.start + seg.len) {
			out.push(seg.el as HTMLElement);
		}
	}
	return out;
}

/** Total walk length of `container` — its one-past-end walk position. */
export function containerDomTextLength(container: ParentNode): DomTextOffset {
	let count = 0;
	for (const seg of walkSegments(container)) count += seg.len;
	return asDomTextOffset(count);
}

/**
 * Walk-space span of the atomic widget strictly containing `offset`, or null when the
 * offset sits in text or exactly on a boundary. Island application snaps replace
 * boundaries outward with this — a text-position range cannot split an atomic widget.
 */
export function widgetSpanContainingOffset(
	container: ParentNode,
	offset: DomTextOffset
): { start: DomTextOffset; end: DomTextOffset } | null {
	for (const seg of walkSegments(container)) {
		if (seg.start > offset) break;
		if (
			seg.kind === 'widget' &&
			seg.len > 0 &&
			seg.start < offset &&
			offset < seg.start + seg.len
		) {
			return { start: asDomTextOffset(seg.start), end: asDomTextOffset(seg.start + seg.len) };
		}
	}
	return null;
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

export function createRangeAtDomTextOffsets(
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
	const startPos = findDomTextOffsetTarget(container, start);
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
	const endPos = findDomTextOffsetTarget(container, end);
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

// ── Internal ─────────────────────────────────────────────────────────────────

type WalkSegment =
	| { kind: 'text'; node: Node; start: number; len: number }
	| { kind: 'widget'; el: Element; start: number; len: number };

/**
 * The classification every walk-space consumer shares: a text node contributes its
 * textContent length, an atomic widget its raw source length (never descended), any other
 * element is transparent. Offsets stay plain numbers — consumers mint the `DomTextOffset`
 * brand at the same sites the walks always did.
 */
function* walkSegments(root: ParentNode): Generator<WalkSegment> {
	let count = 0;
	function* visit(node: Node): Generator<WalkSegment> {
		if (node.nodeType === Node.TEXT_NODE) {
			const len = node.textContent?.length ?? 0;
			yield { kind: 'text', node, start: count, len };
			count += len;
			return;
		}
		if (node.nodeType === Node.ELEMENT_NODE) {
			const el = node as Element;
			if (el.matches?.(WIDGET_SELECTOR)) {
				const len = widgetRawLength(el);
				yield { kind: 'widget', el, start: count, len };
				count += len;
				return;
			}
			for (const child of node.childNodes) yield* visit(child);
		}
	}
	for (const child of root.childNodes) yield* visit(child);
}

/**
 * A DOM position re-expressed as a document-order landmark, so a walk can find it without
 * a parallel descent. Text positions need none: every text node under `container` is
 * either a segment of its own or lives inside a widget.
 */
type PositionBoundary = { node: Node; side: 'before' | 'afterContents' };

function positionBoundary(node: Node, offset: number): PositionBoundary | null {
	if (node.nodeType === Node.TEXT_NODE) return null;
	const child = node.childNodes[offset];
	return child ? { node: child, side: 'before' } : { node, side: 'afterContents' };
}

function startsAtOrAfter(segNode: Node, boundary: PositionBoundary): boolean {
	if (segNode === boundary.node) return boundary.side === 'before';
	const mask = boundary.node.compareDocumentPosition(segNode);
	if ((mask & Node.DOCUMENT_POSITION_FOLLOWING) === 0) return false;
	// A descendant follows the landmark's start but precedes the end of its contents, so
	// only the 'before' side counts it.
	return boundary.side === 'before' || (mask & Node.DOCUMENT_POSITION_CONTAINED_BY) === 0;
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
