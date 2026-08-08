/**
 * The single DOM Range ↔ raw offset translation point (`docs/design/editor.md`). Atomic
 * inline widgets contribute their raw bytes via data-source-start / data-source-end
 * without contributing to textContent; the walk sums text-node lengths — a leading
 * ambient marker span's text included — plus widget raw lengths, so walk positions are
 * `DomTextOffset` and `ambient/ambient-cursor.ts` owns the ± ambientLength step to raw.
 */

import { hidesMarkers, type PresentationMode } from '../presentation-mode';
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
	const mode = markerHidingMode(container);
	let total = 0;
	for (const seg of walkSegments(container, mode)) {
		const segNode = seg.kind === 'text' ? seg.node : seg.el;
		if (seg.kind === 'widget' && seg.el.contains(node)) {
			return asDomTextOffset(offset === 0 ? seg.start : seg.start + seg.len);
		}
		if (segNode === node) {
			const at = seg.start + offset;
			// A hidden run is opaque like a widget: its interior positions all paint at one
			// pixel, so the walk reports the boundary the position leans toward instead.
			if (seg.kind === 'text' && seg.hiddenRoot !== null) {
				return snapOutOfRun(container, at, offset === 0 ? 'before' : 'after', mode);
			}
			return asDomTextOffset(at);
		}
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
	for (const seg of landingSegments(container, markerHidingMode(container))) {
		if (seg.kind === 'text') {
			if (seg.start + seg.len >= target) return { node: seg.node, offset: target - seg.start };
			last = { node: seg.node, offset: seg.len };
			continue;
		}
		// An opaque span holds no landable position, so a target at either boundary resolves
		// beside it. The walk offset is preserved: only the DOM spelling of it changes.
		if (seg.start === target) {
			const before = positionBeside(seg.first, 'before');
			if (before) return before;
		}
		const after = positionBeside(seg.last, 'after');
		if (!after) continue;
		if (seg.start + seg.len >= target) return after;
		last = after;
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
	for (const seg of walkSegments(container, null)) {
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
	for (const seg of walkSegments(container, null)) count += seg.len;
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
	for (const seg of walkSegments(container, null)) {
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

// ── Hidden marker runs ───────────────────────────────────────────────────────

/**
 * Whether `node` is text the mode CSS paints nothing for — a marker span's own text under a
 * marker-hiding mode with no reveal on it. Detected structurally against the CSS families in
 * `styles/editor.css`, never by layout: a `getComputedStyle` per keystroke is not affordable,
 * so the selector vocabulary here and the stylesheet's move together.
 */
export function isHiddenMarkerText(node: Node, container: HTMLElement): boolean {
	if (node.nodeType !== Node.TEXT_NODE || !container.contains(node)) return false;
	const mode = markerHidingMode(container);
	if (mode === null) return false;
	for (let el = node.parentElement; el && el !== container; el = el.parentElement) {
		if (hidesOwnText(el, mode)) return true;
	}
	return false;
}

/**
 * `offset` moved off a hidden run's interior to that run's `side` boundary; boundaries and
 * visible text come back unchanged. Caret landings snap before they seat: a run's interior
 * has no paint position, so what a browser does with a range there is its own business.
 */
export function snapOutOfHiddenRun(
	container: HTMLElement,
	offset: DomTextOffset,
	side: 'before' | 'after'
): DomTextOffset {
	return snapOutOfRun(container, offset, side, markerHidingMode(container));
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** The classes the marker-hiding families key on. `contenteditable="false"` markers (the
 *  ambient prefix, directive chrome) keep their box and their own caret rule, so they are
 *  excluded here — `ambient/ambient-cursor.ts` owns those. */
const HIDDEN_MARKER_CLASSES = ['md-marker', 'md-fence-line', 'md-ref-label'];
const CONSTRUCT_REVEAL_CLASS = 'md-construct-reveal';
const FOCUSED_HOST_SELECTOR = '.block-host[data-focused]';

/** The editor root's effective mode when it hides markers; null in source mode, which
 *  stamps no attribute, and for a detached build with no root to read. */
function markerHidingMode(container: ParentNode): PresentationMode | null {
	if (!(container instanceof Element)) return null;
	const attr = container.closest('[data-presentation]')?.getAttribute('data-presentation');
	const mode = (attr ?? null) as PresentationMode | null;
	return mode !== null && hidesMarkers(mode) ? mode : null;
}

function hidesOwnText(el: Element, mode: PresentationMode): boolean {
	if (el.getAttribute('contenteditable') === 'false') return false;
	if (!HIDDEN_MARKER_CLASSES.some((cls) => el.classList.contains(cls))) return false;
	if (mode !== 'preview-block' && mode !== 'preview-inline') return true;
	if (!el.closest(FOCUSED_HOST_SELECTOR)) return true;
	// preview-inline reveals per construct; markers with no construct stamp (block-own
	// prefixes, fence lines) reveal with block focus as they do under preview-block.
	return (
		mode === 'preview-inline' &&
		el.hasAttribute('data-construct-start') &&
		!el.classList.contains(CONSTRUCT_REVEAL_CLASS)
	);
}

function snapOutOfRun(
	container: ParentNode,
	offset: number,
	side: 'before' | 'after',
	mode: PresentationMode | null
): DomTextOffset {
	if (mode === null) return asDomTextOffset(offset);
	for (const seg of landingSegments(container, mode)) {
		if (seg.start > offset) break;
		if (seg.kind === 'opaque' && seg.hidden && seg.start < offset && offset < seg.start + seg.len) {
			return asDomTextOffset(side === 'before' ? seg.start : seg.start + seg.len);
		}
	}
	return asDomTextOffset(offset);
}

/** The landable DOM position beside a span the caret may not enter. Prefers an adjacent
 *  text node — Chromium drops beforeinput at element-level offsets between two islands. */
function positionBeside(el: Element, side: 'before' | 'after'): DomPosition | null {
	const parent = el.parentNode;
	if (!parent) return null;
	const sibling = side === 'before' ? el.previousSibling : el.nextSibling;
	if (sibling && sibling.nodeType === Node.TEXT_NODE) {
		return { node: sibling, offset: side === 'before' ? (sibling.textContent?.length ?? 0) : 0 };
	}
	const idx = Array.prototype.indexOf.call(parent.childNodes, el);
	return { node: parent, offset: side === 'before' ? idx : idx + 1 };
}

type WalkSegment =
	| { kind: 'text'; node: Node; start: number; len: number; hiddenRoot: Element | null }
	| { kind: 'widget'; el: Element; start: number; len: number };

/**
 * The classification every walk-space consumer shares: a text node contributes its
 * textContent length, an atomic widget its raw source length (never descended), any other
 * element is transparent. Hidden marker text counts exactly like visible text — hiding is
 * CSS-only so the coordinate space survives it — and carries the span that hides it.
 * Offsets stay plain numbers: consumers mint the `DomTextOffset` brand at the same sites
 * the walks always did.
 */
function* walkSegments(root: ParentNode, mode: PresentationMode | null): Generator<WalkSegment> {
	let count = 0;
	function* visit(node: Node, hiddenRoot: Element | null): Generator<WalkSegment> {
		if (node.nodeType === Node.TEXT_NODE) {
			const len = node.textContent?.length ?? 0;
			yield { kind: 'text', node, start: count, len, hiddenRoot };
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
			const inner = hiddenRoot ?? (mode !== null && hidesOwnText(el, mode) ? el : null);
			for (const child of node.childNodes) yield* visit(child, inner);
		}
	}
	for (const child of root.childNodes) yield* visit(child, null);
}

type LandingSegment =
	| { kind: 'text'; node: Node; start: number; len: number }
	| {
			kind: 'opaque';
			hidden: boolean;
			first: Element;
			last: Element;
			start: number;
			len: number;
	  };

/**
 * The same walk as the caret sees it: landable text, and opaque spans it may not enter —
 * atomic widgets, plus MAXIMAL runs of hidden marker text, coalesced because snapping out of
 * one hidden span into the next would still leave the caret in unpainted text.
 */
function* landingSegments(
	root: ParentNode,
	mode: PresentationMode | null
): Generator<LandingSegment> {
	let run: Extract<LandingSegment, { kind: 'opaque' }> | null = null;
	for (const seg of walkSegments(root, mode)) {
		if (seg.kind === 'text' && seg.hiddenRoot !== null) {
			if (run) {
				run.len += seg.len;
				run.last = seg.hiddenRoot;
			} else {
				run = {
					kind: 'opaque',
					hidden: true,
					first: seg.hiddenRoot,
					last: seg.hiddenRoot,
					start: seg.start,
					len: seg.len
				};
			}
			continue;
		}
		if (run) {
			yield run;
			run = null;
		}
		if (seg.kind === 'text') yield seg;
		else {
			yield {
				kind: 'opaque',
				hidden: false,
				first: seg.el,
				last: seg.el,
				start: seg.start,
				len: seg.len
			};
		}
	}
	if (run) yield run;
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
