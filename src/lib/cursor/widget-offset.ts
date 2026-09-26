/**
 * The one place a DOM position is translated to a raw offset and back, and the one place a caret
 * is written from a raw offset (`docs/design/editor.md`). The walk offset (`DomTextOffset`) sums
 * text-node lengths, the leading marker prefix's text included, plus each atomic widget's source
 * length. A raw offset is that minus the prefix length, which this module reads off the DOM.
 */

import {
	asPresentationMode,
	hidesMarkers,
	hidesDelimitersAtCaret,
	type PresentationMode
} from '../presentation-mode';
import { widgetSourceRange } from '../core/inline/inline-widgets';
import {
	familyHidesText,
	familyPaintsAlone,
	isMarkerPrefixSpan,
	markerFamilyOf,
	screenVisibility,
	type MarkerFamily,
	type VisibilityContext
} from '../core/inline/visibility';
import {
	asDomTextOffset,
	asRawOffset,
	toClampedRawOffset,
	toDomTextOffset,
	type DomTextOffset,
	type RawOffset
} from './coordinate-spaces';
import { domDescendants } from './dom-walk';

// ── Raw offsets and the caret ────────────────────────────────────────────────

/** How a caret write treats its offset: `reachable` moves it onto a position the mode lets a caret
 *  sit at (never behind a hidden marker run); `exact` writes it as given. */
export type CaretClamp = 'reachable' | 'exact';

/** A span of a block's raw offsets. */
export interface RawRange {
	start: number;
	end: number;
}

/**
 * The container's leading marker prefix span (`- `, `> `), or null. Empty text nodes before it
 * are skipped, since Chromium leaves them behind and they hold no offset.
 */
export function markerPrefixOf(container: ParentNode): HTMLElement | null {
	let first = container.firstChild;
	while (first?.nodeType === Node.TEXT_NODE && (first.textContent ?? '') === '') {
		first = first.nextSibling;
	}
	return first instanceof HTMLElement && isMarkerPrefixSpan(first) ? first : null;
}

/** The marker prefix's walk length: what a raw offset adds to become a walk offset. */
export function markerPrefixLength(container: ParentNode): number {
	return markerPrefixOf(container)?.textContent?.length ?? 0;
}

/** The raw offset of a live `(node, offset)` DOM position in `el`; a position inside the marker
 *  prefix reads as raw 0. */
export function rawOffsetAt(el: HTMLElement, node: Node, offset: number): RawOffset {
	return rawOfWalkOffset(el, domTextOffsetAtNode(el, node, offset));
}

/** A raw offset in `container` as a walk offset. */
export function walkOffsetOfRaw(container: ParentNode, raw: number): DomTextOffset {
	return toDomTextOffset(asRawOffset(raw), markerPrefixLength(container));
}

/** A walk offset in `container` as a raw offset; one inside the marker prefix reads as raw 0. */
export function rawOfWalkOffset(container: ParentNode, walk: DomTextOffset): RawOffset {
	return toClampedRawOffset(walk, markerPrefixLength(container));
}

/** The raw bytes `el` shows, its marker prefix left out: what a prose block reads back as its text. */
export function rawTextOfContent(el: HTMLElement, raw: string): string {
	const prefix = markerPrefixOf(el);
	let out = '';
	for (const child of Array.from(el.childNodes)) {
		if (child !== prefix) out += rawTextOfNode(child, raw);
	}
	return out;
}

/** Raw offset of the live selection's focus inside `el`, or null when there is no selection or
 *  its focus sits outside `el`. */
export function rawSelectionFocus(el: HTMLElement): RawOffset | null {
	const sel = window.getSelection();
	if (!sel || sel.focusNode === null || !el.contains(sel.focusNode)) return null;
	return rawOffsetAt(el, sel.focusNode, sel.focusOffset);
}

/**
 * Put a collapsed caret at raw offset `raw` in `el`: the one caret writer. Raw 0 behind a marker
 * prefix lands just after the prefix span, which Chromium would otherwise bounce the caret out in
 * front of. False when the browser refused the write.
 */
export function placeCaretAtRaw(
	el: HTMLElement,
	raw: number,
	{ clamp }: { clamp: CaretClamp }
): boolean {
	const at = clamp === 'reachable' ? clampToLandableRaw(el, Math.max(0, raw)) : raw;
	const point = caretPointAtRaw(el, at);
	return writeSelection(point, point);
}

/**
 * Select raw `[anchor, focus]` in `el`, backward when the focus comes first. An endpoint at raw 0
 * behind a marker prefix lands after the span, as a caret does.
 */
export function selectRawRange(el: HTMLElement, anchor: number, focus: number): boolean {
	return writeSelection(caretPointAtRaw(el, anchor), caretPointAtRaw(el, focus));
}

/** Move the live selection's focus to raw `raw` in `el`, keeping its anchor. */
export function extendSelectionToRaw(el: HTMLElement, raw: number): boolean {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0 || sel.anchorNode === null) return false;
	return writeSelection(
		{ node: sel.anchorNode, offset: sel.anchorOffset },
		caretPointAtRaw(el, raw)
	);
}

/**
 * Select `el`'s whole content, past its marker prefix when there is content to select: the first
 * Ctrl+A range, the triple click. With none, the whole contents, marker included.
 */
export function selectSurfaceContent(el: HTMLElement): boolean {
	const contentLength = containerDomTextLength(el) - markerPrefixLength(el);
	if (markerPrefixOf(el) && contentLength > 0) return selectRawRange(el, 0, contentLength);
	const range = document.createRange();
	range.selectNodeContents(el);
	return writeSelection(
		{ node: range.startContainer, offset: range.startOffset },
		{ node: range.endContainer, offset: range.endOffset }
	);
}

/**
 * A DOM Range over raw `[start, end)` in `container`, for measuring or decorating it; a caret
 * write goes through {@link placeCaretAtRaw} instead. A range from raw 0 starts right after the
 * marker prefix span, so it holds whole elements rather than the inside of the first one.
 */
export function rawRangeToDomRange(
	container: ParentNode,
	start: number,
	end: number
): Range | null {
	const range = createRangeAtDomTextOffsets(
		container,
		walkOffsetOfRaw(container, start),
		walkOffsetOfRaw(container, end)
	);
	const prefix = markerPrefixOf(container);
	if (!range || !prefix || start > 0) return range;
	range.setStartAfter(prefix);
	if (end <= 0) range.collapse(true);
	return range;
}

/** Where a caret at raw `raw` goes in the DOM: the end of an empty container's contents when the
 *  walk finds no position at all. */
function caretPointAtRaw(el: HTMLElement, raw: number): DomPosition {
	const pos = findDomTextOffsetTarget(el, walkOffsetOfRaw(el, Math.max(0, raw)));
	return pos ?? { node: el, offset: el.childNodes.length };
}

/**
 * Raw 0 behind a marker prefix: the first text after the span, which has real rects where the
 * spot after the span may not, unless that text is a hidden marker run, which paints nothing.
 */
function positionAfterPrefix(container: ParentNode, prefix: HTMLElement): DomPosition {
	const textAfter = firstTextNodeAfter(prefix);
	const hidden =
		textAfter !== null &&
		container instanceof HTMLElement &&
		isHiddenMarkerText(textAfter, container);
	if (textAfter && !hidden) return { node: textAfter, offset: 0 };
	const parent = prefix.parentNode!;
	return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, prefix) + 1 };
}

function writeSelection(anchor: DomPosition, focus: DomPosition): boolean {
	const sel = window.getSelection();
	if (!sel) return false;
	try {
		sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
	} catch {
		return false;
	}
	return true;
}

/** The first non-empty text node after `node` in document order, stopping at an atomic widget,
 *  whose bytes lie between the two. */
function firstTextNodeAfter(node: Node): Text | null {
	for (let sibling = node.nextSibling; sibling; sibling = sibling.nextSibling) {
		if (isAtomicInlineWidget(sibling)) return null;
		for (const current of domDescendants(sibling)) {
			if (current.nodeType === Node.TEXT_NODE && (current.textContent?.length ?? 0) > 0) {
				return current as Text;
			}
		}
	}
	return null;
}

const WIDGET_ATTR = 'data-inline-widget';

/** The data attribute a block writes on its editable element while {@link holdsOnlyMarkerChrome}
 *  holds; this walk and `styles/editor.css` both read it. Written in every mode, since it states
 *  a fact about the content, so a mode switch never finds it stale. */
export const CONTENT_EMPTY_ATTR = 'data-content-empty';

/** The class the preview-inline reveal trigger sets and this walk's hiding rule reads, defined
 *  once so the two sides cannot drift. */
export const CONSTRUCT_REVEAL_CLASS = 'md-construct-reveal';

/**
 * The DOM-walk offset of a live `(node, offset)` DOM position. A position inside an atomic
 * widget snaps to the widget's own boundary (browsers do put carets inside these
 * contenteditable=false spans); a position outside the container reads as the end of the walk,
 * so a caller that must tell "not mine" apart checks containment first.
 */
export function domTextOffsetAtNode(
	container: HTMLElement,
	node: Node,
	offset: number
): DomTextOffset {
	// Document order against a node outside the container is browser-specific, so such a
	// position reads as the end of the walk instead.
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
			// A run of hidden marker text is opaque like a widget: every position inside it paints
			// at one pixel, so the walk reports whichever boundary the position leans toward.
			if (seg.kind === 'text' && seg.hiddenRoot !== null) {
				return snapOutOfRun(container, at, offset === 0 ? 'before' : 'after', mode);
			}
			return asDomTextOffset(at);
		}
		// An element-level position resolves to a segment's start, which can sit inside a merged
		// hidden run just like a text position; it leans backward, so it snaps that way.
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
 * A DOM-walk offset back to a live `(node, offset)` DOM position; `findNodeAtOffset` in
 * `core/inline-render.ts` is the same lookup over the inline tree. Accepts a detached fragment
 * (decoration widgets are applied to builds in progress) with the same arithmetic as a live block.
 */
export function findDomTextOffsetTarget(
	container: ParentNode,
	target: DomTextOffset
): DomPosition | null {
	return findDomTextLanding(container, target)?.position ?? null;
}

/**
 * {@link findDomTextOffsetTarget}, also saying whether the position sits in visible text at
 * `target` itself, whose walk offset is then `target` with no second walk to read it back.
 */
export function findDomTextLanding(
	container: ParentNode,
	target: DomTextOffset
): { position: DomPosition; inTextAtTarget: boolean } | null {
	// The marker prefix is read-only and Chromium bounces a caret out in front of it, so every
	// target up to its far edge resolves past it, where raw 0 sits.
	const prefix = markerPrefixOf(container);
	const prefixLength = prefix?.textContent?.length ?? 0;
	if (prefix && target <= prefixLength) {
		return { position: positionAfterPrefix(container, prefix), inTextAtTarget: false };
	}
	let last: DomPosition | null = null;
	for (const seg of landingSegments(container, markerHidingMode(container))) {
		if (seg.kind === 'text') {
			if (seg.start + seg.len >= target) {
				return { position: { node: seg.node, offset: target - seg.start }, inTextAtTarget: true };
			}
			last = { node: seg.node, offset: seg.len };
			continue;
		}
		// The caret cannot sit inside an opaque span, so a target at either boundary resolves to
		// the position beside it; the walk offset is unchanged, only its DOM spelling differs.
		if (seg.start === target) {
			const before = positionBeside(seg.first, 'before');
			if (before) return { position: before, inTextAtTarget: false };
		}
		const after = positionBeside(seg.last, 'after');
		if (!after) continue;
		// Chromium moves a caret placed after a hidden run to before it, so a byte typed there
		// would land before the run; the text node starting at the target is the position that keeps it.
		if (seg.start + seg.len > target || (seg.start + seg.len === target && !seg.hidden)) {
			return { position: after, inTextAtTarget: false };
		}
		last = after;
	}
	if (prefix && last && prefix.contains(last.node)) last = positionAfterPrefix(container, prefix);
	return last && { position: last, inTextAtTarget: false };
}

/**
 * The atomic inline widgets in `container` that intersect the DOM-walk range [start, end). A
 * widget adds nothing to textContent, so a range inside one yields no client rect; a caller that
 * must cover it (search highlight, cross-block selection) takes its bounding box instead. A
 * widget's position is its running walk offset, never `data-source-*` compared against the
 * marker-adjusted argument.
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

/** The walk's text with marker text and widget bytes blanked to spaces, at the walk's own
 *  offsets: what a rule that reads words (double- and triple-click) sees as content. */
export function maskedWalkText(container: ParentNode): string {
	let out = '';
	for (const seg of walkSegments(container, null)) {
		const content = seg.kind === 'text' && markerRootOf(seg.node, container) === null;
		out += content ? (seg.node.textContent ?? '') : ' '.repeat(seg.len);
	}
	return out;
}

/** Whether any visible text in `container` ends past `from`: a caret there has a box of its own,
 *  which a block of widgets alone never offers. */
export function holdsTextPast(container: ParentNode, from: DomTextOffset): boolean {
	for (const seg of landingSegments(container, markerHidingMode(container))) {
		if (seg.kind === 'text' && seg.len > 0 && seg.start + seg.len > from) return true;
	}
	return false;
}

/** Total walk length of `container`: its one-past-end walk position. */
export function containerDomTextLength(container: ParentNode): DomTextOffset {
	let count = 0;
	for (const seg of walkSegments(container, null)) count += seg.len;
	return asDomTextOffset(count);
}

/**
 * The DOM-walk span of the atomic widget strictly containing `offset`, or null when the offset
 * sits in text or exactly on a boundary. Applying a replace decoration snaps its boundaries
 * outward with this, since a text-position range cannot split an atomic widget.
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
	let out = '';
	for (const node of domDescendants(domNode, isTransparentContainer)) {
		if (node.nodeType === Node.TEXT_NODE) {
			out += node.textContent ?? '';
			continue;
		}
		if (isAtomicInlineWidget(node)) {
			const range = widgetSourceRange(node as Element);
			if (range) out += raw.slice(range.start, range.end);
		}
	}
	return out;
}

/** A node whose own bytes are its children's: a widget stands for its source range instead, and
 *  anything that is neither element nor fragment stands for nothing. */
const isTransparentContainer = (node: Node): boolean =>
	(node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) &&
	!isAtomicInlineWidget(node);

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
 * Whether `node` is text the mode's CSS paints nothing for: a marker span's own text under a
 * marker-hiding mode with no reveal on it. Decided from the marker families in
 * `core/inline/visibility.ts`, never from layout, since a `getComputedStyle` per keystroke is
 * too slow; that file and `styles/editor.css` must change together.
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
 * Whether `el`'s own text is marker text the container's mode paints nothing for: the element
 * form of {@link isHiddenMarkerText}, for a walk that treats such a span as opaque instead of
 * descending into it.
 */
export function isHiddenMarkerRoot(el: Element, container: HTMLElement): boolean {
	if (el === container || !container.contains(el)) return false;
	const mode = markerHidingMode(container);
	return mode !== null && hidesOwnText(el, mode, chromeStandsAloneUnder(container, mode));
}

/**
 * `hidesDelimitersAtCaret` read from the DOM: whether this container's mode paints no marker at
 * all in the focused block, neither its own prefix (`## `, a fence, a setext underline) nor an
 * inline construct's delimiters. A container with no mode attribute is styled source, which paints.
 */
export function revealsNoMarkers(container: ParentNode): boolean {
	const mode = markerHidingMode(container);
	return mode !== null && hidesDelimitersAtCaret(mode);
}

/**
 * How this container's bytes read on screen: its mode plus its content-empty attribute, resolved
 * here so a text-rewriting caller needs no marker knowledge of its own. Markers standing over no
 * content paint (live-mode.md § 4.1), so a rewrite allowed only over hidden bytes has nothing to
 * do there. An unmounted block reads as source, where nothing hides.
 */
export function screenVisibilityOf(container: ParentNode | null): VisibilityContext {
	return screenVisibility(
		container === null ? 'source' : (markerHidingMode(container) ?? 'source'),
		{ chromePaints: container instanceof Element && chromeStampPaints(container) }
	);
}

/** The stylesheet's condition for painting an empty construct's markers: `data-content-empty`
 *  plus focus inside, read by containment because jsdom lacks `:focus-within`. */
function chromeStampPaints(container: Element): boolean {
	if (!container.hasAttribute(CONTENT_EMPTY_ATTR)) return false;
	const active = container.ownerDocument.activeElement;
	return active !== null && container.contains(active);
}

/**
 * The first and last walk offsets a caret can sit at in `container`, past any hidden marker run
 * and the leading marker prefix; the checks at a block's edge read these instead of 0 and the
 * walk length. A container whose text is all hidden (an empty fence) answers `{len, len}`.
 */
export function landableDomTextBounds(container: ParentNode): {
	start: DomTextOffset;
	end: DomTextOffset;
} {
	let start = 0;
	let end = 0;
	let landed = false;
	let lastText: Node | null = null;
	for (const seg of landingSegments(container, markerHidingMode(container))) {
		if (seg.len === 0) continue;
		const stop = seg.start + seg.len;
		// An atomic widget and a decoration widget are opaque, not unreachable: the caret may not
		// enter either, but each of their boundaries is a position of its own.
		if (seg.kind === 'opaque' ? seg.hidden : inMarkerPrefix(seg.node, container)) {
			if (!landed) start = stop;
			continue;
		}
		landed = true;
		end = stop;
		lastText = seg.kind === 'text' ? seg.node : null;
	}
	// The position after the last reachable text's final `\n` starts a line nothing paints: the
	// browser puts no caret there, so an end check reading it would never fire and the caret would
	// stick on the empty line. A caret anchor gives that line its paint and keeps the position.
	if (lastText?.textContent?.endsWith('\n') && !followedByCaretAnchor(lastText, container)) {
		end -= 1;
	}
	return { start: asDomTextOffset(start), end: asDomTextOffset(Math.max(start, end)) };
}

/** Whether the next painted node after `text`, at any depth above it, is a caret anchor. */
function followedByCaretAnchor(text: Node, root: ParentNode): boolean {
	for (let node: Node | null = text; node && node !== root; node = node.parentNode) {
		let next = node.nextSibling;
		while (next?.nodeType === Node.TEXT_NODE && (next.textContent?.length ?? 0) === 0) {
			next = next.nextSibling;
		}
		if (next)
			return next instanceof HTMLElement && next.tagName === 'BR' && 'caretAnchor' in next.dataset;
	}
	return false;
}

/**
 * The container's bytes outside its markers: its content, whatever the mode paints. A fence
 * with an empty body answers whitespace, which the block reads as "nothing here for Backspace
 * to delete but the block itself".
 */
export function chromeFreeText(container: ParentNode): string {
	let text = '';
	for (const seg of walkSegments(container, null)) {
		if (seg.kind !== 'text' || seg.len === 0) continue;
		if (markerRootOf(seg.node, container) !== null) continue;
		text += seg.node.textContent ?? '';
	}
	return text;
}

/**
 * Whether every byte in `container` is marker text, with at least one span of a family the
 * empty-construct override paints: the condition the render path writes as `data-content-empty`,
 * computed without reading that attribute so a render never flips the previous one's answer.
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
		// The container's marker prefix keeps its box in every mode, so it neither hides the block
		// nor counts as content: a `- ` with an empty child holds a caret and needs no attribute.
		if (!inMarkerPrefix(seg.node, container)) return false;
	}
	return chrome;
}

/**
 * Whether the mode paints nothing the caret can sit in: every walk segment is a hidden marker
 * run, so no caret position has a pixel of its own. `invariants/landable-caret.ts` refuses this
 * shape when focus lands; an empty container (the caret sits at offset 0) and one fronted by
 * the marker prefix are not this shape.
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
 * {@link landableDomTextBounds} in raw offsets, or null where the mode paints its markers and
 * the whole raw span is reachable. Every caret check and caret placement (the arrow exits, the
 * cross-block collapse, block entry) reads this one answer rather than computing its own.
 */
export function landableRawBounds(el: HTMLElement): RawRange | null {
	if (!revealsNoMarkers(el)) return null;
	const bounds = landableDomTextBounds(el);
	const prefixLength = markerPrefixLength(el);
	return {
		start: toClampedRawOffset(bounds.start, prefixLength),
		end: toClampedRawOffset(bounds.end, prefixLength)
	};
}

/** Clamp a caret offset into the range the caret can sit in; a no-op wherever the markers paint. */
export function clampToLandableRaw(el: HTMLElement, offset: number): number {
	const bounds = landableRawBounds(el);
	if (!bounds) return offset;
	return Math.min(Math.max(offset, bounds.start), bounds.end);
}

/**
 * Whether the first position the caret can sit at abuts an opaque widget (an atomic inline
 * widget, a decoration widget) instead of sitting in text: no text node holds it, so the
 * browser's Home puts the caret past the widget and the editor must place it itself.
 */
export function landableStartAbutsIsland(container: ParentNode): boolean {
	for (const seg of landingSegments(container, markerHidingMode(container))) {
		if (seg.len === 0) continue;
		if (seg.kind === 'opaque') {
			if (seg.hidden) continue;
			return true;
		}
		if (inMarkerPrefix(seg.node, container)) continue;
		return false;
	}
	return false;
}

/** Whether `node` is an atomic inline widget's element, which every walk treats as opaque. Checks
 *  the attribute rather than a selector because every walk asks this per node. */
export function isAtomicInlineWidget(node: Node): boolean {
	return node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute(WIDGET_ATTR);
}

// ── Internal ─────────────────────────────────────────────────────────────────

const FOCUSED_HOST_SELECTOR = '.block-host[data-focused]';

/** The editor root's mode when it hides markers; null in source mode, which sets no attribute,
 *  and for a detached build with no root to read. */
function markerHidingMode(container: ParentNode): PresentationMode | null {
	if (!(container instanceof Element)) return null;
	const mode = asPresentationMode(
		container.closest('[data-presentation]')?.getAttribute('data-presentation')
	);
	return hidesMarkers(mode) ? mode : null;
}

/** The nearest ancestor between `node` and `root` whose own text is a marker, with the family
 *  that decides what the empty-container override does with it. */
function markerRootOf(node: Node, root: ParentNode): { el: Element; family: MarkerFamily } | null {
	for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
		const family = markerFamilyOf(el);
		if (family !== null) return { el, family };
	}
	return null;
}

/** Whether `root` carries the content-empty attribute under a mode that paints its markers. */
function chromeStandsAloneUnder(root: ParentNode, mode: PresentationMode | null): boolean {
	if (mode === null || !(root instanceof Element)) return false;
	return screenVisibility(mode, { chromePaints: chromeStampPaints(root) }).chromePaints;
}

/**
 * Whether `node` is inside the container's marker prefix, the one inert span whose far side is raw
 * offset 0. Every other opaque span (a widget, a decoration) has a real raw offset on each side.
 */
function inMarkerPrefix(node: Node, root: ParentNode): boolean {
	for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
		if (isMarkerPrefixSpan(el)) return true;
	}
	return false;
}

function hidesOwnText(el: Element, mode: PresentationMode, chromePaints: boolean): boolean {
	const family = markerFamilyOf(el);
	// The shared rule first (the stylesheet's `[data-content-empty]` override included); the
	// reveal branches below depend on per-span DOM state that only this side can see.
	if (family === null || !familyHidesText(family, screenVisibility(mode, { chromePaints })))
		return false;
	if (mode !== 'preview-block' && mode !== 'preview-inline') return true;
	if (!el.closest(FOCUSED_HOST_SELECTOR)) return true;
	if (mode === 'preview-block') return false;
	// preview-inline's reveal rule is scoped to `.md-marker`, so a reference label reveals by
	// class alone; fence lines are whole-block markers and reveal with block focus.
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

/** The DOM position beside a span the caret may not enter. Prefers an adjacent text node, since
 *  Chromium drops beforeinput at element-level offsets between two widgets. */
function positionBeside(el: Element, side: 'before' | 'after'): DomPosition | null {
	const parent = el.parentNode;
	if (!parent) return null;
	const sibling = side === 'before' ? el.previousSibling : el.nextSibling;
	if (sibling && sibling.nodeType === Node.TEXT_NODE) {
		return { node: sibling, offset: side === 'before' ? (sibling.textContent?.length ?? 0) : 0 };
	}
	const idx = Array.prototype.indexOf.call(parent.childNodes, el);
	// A pending hard break's first anchor (`inline-render.ts`) ends the line the marker sat on;
	// the position past the marker is the start of the next line, after that anchor.
	if (side === 'after' && isBreakAnchor(sibling)) return { node: parent, offset: idx + 2 };
	return { node: parent, offset: side === 'before' ? idx : idx + 1 };
}

function isBreakAnchor(node: Node | null): boolean {
	return (
		node instanceof HTMLElement && node.tagName === 'BR' && node.dataset.caretAnchor === 'break'
	);
}

type WalkSegment =
	| { kind: 'text'; node: Node; start: number; len: number; hiddenRoot: Element | null }
	| { kind: 'widget'; el: Element; start: number; len: number };

/**
 * The segments every walk reader shares: a text node counts its text length, an atomic widget
 * its raw source length (never descended), any other element nothing. Hidden marker text counts
 * like visible text, since hiding is CSS-only, and carries the span that hides it.
 */
function* walkSegments(root: ParentNode, mode: PresentationMode | null): Generator<WalkSegment> {
	let count = 0;
	// One read per walk, not one `closest` per element: every caller passes the walk container.
	const chromePaints = chromeStandsAloneUnder(root, mode);
	const stack: { node: Node; hiddenRoot: Element | null }[] = [];
	// Pushed in reverse so pop order is source order, which `count` advances along.
	const pushChildren = (parent: Node, hiddenRoot: Element | null) => {
		const children = parent.childNodes;
		for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], hiddenRoot });
	};
	pushChildren(root, null);
	while (stack.length > 0) {
		const { node, hiddenRoot } = stack.pop()!;
		if (node.nodeType === Node.TEXT_NODE) {
			const len = node.textContent?.length ?? 0;
			yield { kind: 'text', node, start: count, len, hiddenRoot };
			count += len;
			continue;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) continue;
		const el = node as Element;
		if (isAtomicInlineWidget(el)) {
			const len = widgetRawLength(el);
			yield { kind: 'widget', el, start: count, len };
			count += len;
			continue;
		}
		pushChildren(
			el,
			hiddenRoot ?? (mode !== null && hidesOwnText(el, mode, chromePaints) ? el : null)
		);
	}
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

type OpaqueSegment = Extract<LandingSegment, { kind: 'opaque' }>;

/** A new opaque span is one element, its own first and last, until a run extends it. */
function opaqueSegment(el: Element, start: number, len: number, hidden: boolean): OpaqueSegment {
	return { kind: 'opaque', hidden, first: el, last: el, start, len };
}

/**
 * The walk as the caret sees it: text it can sit in, and opaque spans it may not enter, which are
 * atomic widgets plus whole runs of hidden marker text. Adjacent hidden spans merge into one run
 * because snapping out of one into the next would still leave the caret in unpainted text.
 */
function* landingSegments(
	root: ParentNode,
	mode: PresentationMode | null
): Generator<LandingSegment> {
	let run: OpaqueSegment | null = null;
	for (const seg of walkSegments(root, mode)) {
		// A node contributing nothing cannot end a run: Chromium leaves empty text nodes between
		// spans, and splitting the run there would create a caret position nothing paints.
		if (run && seg.len === 0) continue;
		if (seg.kind === 'text' && seg.hiddenRoot !== null) {
			if (run) {
				run.len += seg.len;
				run.last = seg.hiddenRoot;
			} else {
				run = opaqueSegment(seg.hiddenRoot, seg.start, seg.len, true);
			}
			continue;
		}
		if (run) {
			yield run;
			run = null;
		}
		if (seg.kind === 'text') yield seg;
		else yield opaqueSegment(seg.el, seg.start, seg.len, false);
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
