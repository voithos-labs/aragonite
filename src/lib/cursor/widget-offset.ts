/**
 * The single DOM Range ↔ raw offset translation point (`docs/design/editor.md`). Atomic
 * inline widgets contribute their raw bytes via data-source-start / data-source-end
 * without contributing to textContent; the walk sums text-node lengths — a leading
 * ambient marker span's text included — plus widget raw lengths, so walk positions are
 * `DomTextOffset` and `ambient/ambient-cursor.ts` owns the ± ambientLength step to raw.
 */

import { hidesMarkers, isPreviewMode, type PresentationMode } from '../presentation-mode';
import { widgetSourceRange } from '../core/inline/inline-widgets';
import {
	familyHidesText,
	familyPaintsAlone,
	markerFamilyOf,
	screenVisibility,
	type MarkerFamily,
	type VisibilityContext
} from '../core/inline/visibility';
import { asDomTextOffset, toClampedRawOffset, type DomTextOffset } from './coordinate-spaces';

const WIDGET_SELECTOR = '[data-inline-widget]';

/** The stamp a block surface writes on its walk container while {@link holdsOnlyMarkerChrome}
 *  holds. Both consumers of the hiding rule — this walk and `styles/editor.css` — read it.
 *  Written in every mode on purpose: it is a content fact, so a flip never finds it stale. */
export const CONTENT_EMPTY_ATTR = 'data-content-empty';

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
		// An element-level position resolves to a segment's start, which a coalesced run makes
		// as interior as a text position — it leans backward, so it snaps that way.
		if (boundary && startsAtOrAfter(segNode, boundary)) {
			return snapOutOfRun(container, seg.start, 'before', mode);
		}
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
			const range = widgetSourceRange(el);
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
 * marker-hiding mode with no reveal on it. Detected structurally against the families in
 * `core/inline/visibility.ts`, never by layout: a `getComputedStyle` per keystroke is not
 * affordable, so that vocabulary and `styles/editor.css` move together.
 */
export function isHiddenMarkerText(node: Node, container: HTMLElement): boolean {
	if (node.nodeType !== Node.TEXT_NODE || !container.contains(node)) return false;
	const mode = markerHidingMode(container);
	if (mode === null) return false;
	const chromePaints = chromeStandsAloneUnder(container, mode);
	for (let el = node.parentElement; el && el !== container; el = el.parentElement) {
		if (hidesOwnText(el, mode, chromePaints)) return true;
	}
	return false;
}

/**
 * Whether `el`'s OWN text is marker text the container's mode paints nothing for — the
 * element-level form of {@link isHiddenMarkerText}, for a walk that treats such a span as
 * opaque instead of descending into it.
 */
export function isHiddenMarkerRoot(el: Element, container: HTMLElement): boolean {
	if (el === container || !container.contains(el)) return false;
	const mode = markerHidingMode(container);
	return mode !== null && hidesOwnText(el, mode, chromeStandsAloneUnder(container, mode));
}

/**
 * Whether the mode paints NO marker in the focused block — neither its own structural prefix
 * (`## `, a fence, a setext underline) nor an inline construct's delimiters. The preview rungs
 * reveal both, so only a hiding mode with no reveal moves where that block's caret can go.
 */
export function revealsNoMarkers(container: ParentNode): boolean {
	const mode = markerHidingMode(container);
	return mode !== null && !isPreviewMode(mode);
}

/**
 * How this container's bytes read on screen: its mode and its content-empty stamp, resolved here
 * so a rewrite seam needs no marker vocabulary of its own. Chrome standing over no content PAINTS
 * (live-mode.md § 4.1), and a seam holding a license over unseen bytes has nothing to claim there.
 * An unmounted surface reads as source, where nothing hides and no rewrite has a run to move.
 */
export function screenVisibilityOf(container: ParentNode | null): VisibilityContext {
	return screenVisibility(
		container === null ? 'source' : (markerHidingMode(container) ?? 'source'),
		{ chromePaints: container instanceof Element && container.hasAttribute(CONTENT_EMPTY_ATTR) }
	);
}

/**
 * The extreme walk offsets a caret can occupy in `container`: a hidden marker run or the leading
 * ambient island holds no landable position, so the bound moves past it. Block-edge gates read
 * these rather than 0 / walk length, which a mode painting no marker makes unreachable — a gate
 * testing an offset no keystroke can produce is a dead key. An ALL-hidden container (an empty
 * fence) has no landable offset and answers `{len, len}`, making every `offset <= start` gate true.
 */
export function landableDomTextBounds(container: ParentNode): {
	start: DomTextOffset;
	end: DomTextOffset;
} {
	let start = 0;
	let end = 0;
	let landed = false;
	for (const seg of landingSegments(container, markerHidingMode(container))) {
		if (seg.len === 0) continue;
		const stop = seg.start + seg.len;
		// An atomic widget and a decoration island are opaque, not unreachable: the caret may not
		// enter either, but both of their boundaries are positions of their own.
		if (seg.kind === 'opaque' ? seg.hidden : inAmbientIsland(seg.node, container)) {
			if (!landed) start = stop;
			continue;
		}
		landed = true;
		end = stop;
	}
	return { start: asDomTextOffset(start), end: asDomTextOffset(Math.max(start, end)) };
}

/**
 * Whether every byte `container` holds is marker chrome, at least one span of it a family the
 * empty-construct override paints. The stamp condition the render path writes as
 * `data-content-empty` and the walk reads back — computed WITHOUT reading the stamp, or each
 * render would flip the previous one's answer. Membership and paintability are separate
 * questions: a reference label is chrome that stays hidden, so it is not content standing behind
 * the stamp, and it is not the paint the stamp promises either.
 */
export function holdsOnlyMarkerChrome(container: ParentNode): boolean {
	let chrome = false;
	for (const seg of walkSegments(container, null)) {
		if (seg.len === 0) continue;
		if (seg.kind === 'widget') return false;
		const marker = markerRootOf(seg.node, container);
		if (marker !== null) {
			chrome ||= familyPaintsAlone(marker.family);
			continue;
		}
		// The ambient island keeps its box in every mode, so it neither hides the block nor
		// stands in for content: a `- ` with an empty child is landable and needs no stamp.
		if (!inAmbientIsland(seg.node, container)) return false;
	}
	return chrome;
}

/**
 * Whether the mode paints NOTHING landable here: every walk segment is a hidden marker run, so no
 * caret position has a pixel of its own. `invariants/landable-caret.ts` refuses this shape at the
 * focus seam — an empty container (landable at offset 0) and one fronted by the ambient island are
 * not it.
 */
export function paintsNoLandableContent(container: ParentNode): boolean {
	let hidden = false;
	for (const seg of landingSegments(container, markerHidingMode(container))) {
		if (seg.len === 0) continue;
		if (seg.kind !== 'opaque' || !seg.hidden) return false;
		hidden = true;
	}
	return hidden;
}

/**
 * {@link landableDomTextBounds} in the caret's own raw space, or null where the mode paints its
 * markers and the whole raw span is reachable. The one home every caret gate and caret DOOR
 * reads: the arrow exits, the cross-block collapse, and the block-entry seat all ask the same
 * question and must not answer it three ways.
 */
export function landableRawBounds(
	el: HTMLElement,
	ambientLength: number
): { start: number; end: number } | null {
	if (!revealsNoMarkers(el)) return null;
	const bounds = landableDomTextBounds(el);
	return {
		start: toClampedRawOffset(bounds.start, ambientLength),
		end: toClampedRawOffset(bounds.end, ambientLength)
	};
}

/** Clamp a caret offset into `el`'s landable range — identity wherever the markers paint. */
export function clampToLandableRaw(el: HTMLElement, offset: number, ambientLength: number): number {
	const bounds = landableRawBounds(el, ambientLength);
	if (!bounds) return offset;
	return Math.min(Math.max(offset, bounds.start), bounds.end);
}

/**
 * Whether the first landable position abuts an opaque island (an atomic widget, a decoration
 * island) instead of sitting in text: no text node holds it, so the engine's Home seats the
 * caret past the island and the block's start needs an owned door.
 */
export function landableStartAbutsIsland(container: ParentNode): boolean {
	for (const seg of landingSegments(container, markerHidingMode(container))) {
		if (seg.len === 0) continue;
		if (seg.kind === 'opaque') {
			if (seg.hidden) continue;
			return true;
		}
		if (inAmbientIsland(seg.node, container)) continue;
		return false;
	}
	return false;
}

/** Whether `node` is an atomic inline widget's element — the island every walk treats as opaque. */
export function isAtomicInlineWidget(node: Node): boolean {
	return node.nodeType === Node.ELEMENT_NODE && !!(node as Element).matches?.(WIDGET_SELECTOR);
}

// ── Internal ─────────────────────────────────────────────────────────────────

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

/** Nearest ancestor between `node` and `root` whose own text is marker chrome, with the family
 *  that decides what the stamped-container override does with it. */
function markerRootOf(node: Node, root: ParentNode): { el: Element; family: MarkerFamily } | null {
	for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
		const family = markerFamilyOf(el);
		if (family !== null) return { el, family };
	}
	return null;
}

/** Whether `root` carries the content-empty stamp under a mode that paints it. */
function chromeStandsAloneUnder(root: ParentNode, mode: PresentationMode | null): boolean {
	if (mode === null || !(root instanceof Element)) return false;
	return screenVisibility(mode, { chromePaints: root.hasAttribute(CONTENT_EMPTY_ATTR) })
		.chromePaints;
}

/**
 * Whether `node` is inside the leading ambient marker island — a container's `- ` / `1. ` prefix,
 * the one inert island whose far side IS raw 0. Every other opaque island (a widget, a
 * decoration) has a real raw offset on each side, so only this one joins the unreachable prefix.
 */
function inAmbientIsland(node: Node, root: ParentNode): boolean {
	for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
		if (el.classList.contains('md-marker') && el.getAttribute('contenteditable') === 'false') {
			return true;
		}
	}
	return false;
}

function hidesOwnText(el: Element, mode: PresentationMode, chromePaints: boolean): boolean {
	const family = markerFamilyOf(el);
	// The shared rule first (the stylesheet's `[data-content-empty]` override among it); the
	// reveal arms below are per-span DOM state, which only this side of the model can see.
	if (family === null || !familyHidesText(family, screenVisibility(mode, { chromePaints })))
		return false;
	if (mode !== 'preview-block' && mode !== 'preview-inline') return true;
	if (!el.closest(FOCUSED_HOST_SELECTOR)) return true;
	if (mode === 'preview-block') return false;
	// preview-inline's unstamped-reveal arm is scoped to `.md-marker`, so a ref label reveals
	// by class alone; fence lines are whole-block markers and reveal with block focus.
	if (el.classList.contains('md-fence-line')) return false;
	if (el.classList.contains('md-ref-label')) return !el.classList.contains(CONSTRUCT_REVEAL_CLASS);
	return el.hasAttribute('data-construct-start') && !el.classList.contains(CONSTRUCT_REVEAL_CLASS);
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
 * The classification every walk-space consumer shares: a text node contributes its textContent
 * length, an atomic widget its raw source length (never descended), any other element is
 * transparent. Hidden marker text counts exactly like visible text — hiding is CSS-only so the
 * coordinate space survives it — and carries the span that hides it. Offsets stay plain numbers;
 * consumers mint the `DomTextOffset` brand.
 */
function* walkSegments(root: ParentNode, mode: PresentationMode | null): Generator<WalkSegment> {
	let count = 0;
	// One read per walk, not one `closest` per element: every caller passes the walk container.
	const chromePaints = chromeStandsAloneUnder(root, mode);
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
			const inner =
				hiddenRoot ?? (mode !== null && hidesOwnText(el, mode, chromePaints) ? el : null);
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
		// A zero-contribution node cannot end a run: Chromium leaves empty text nodes between
		// spans, and splitting the run there would mint a landable seam nothing paints.
		if (run && seg.len === 0) continue;
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
	const range = widgetSourceRange(el);
	return range ? Math.max(0, range.end - range.start) : 0;
}
