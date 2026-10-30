/**
 * The one translation between a DOM position and a raw offset, and the offsets a caret can
 * reach. The walk offset (`DomTextOffset`) sums text-node lengths, the marker prefix included,
 * plus each atomic widget's source length; a raw offset is that minus the prefix length.
 */

import {
	markerPrefixOf,
	isHiddenMarkerText,
	isAtomicInlineWidget,
	markerHidingMode,
	walkSegments,
	type WalkSegment,
	isBreakAnchor,
	landingSegments,
	BLOCK_SUFFIX_ATTR,
	inMarkerPrefix,
	caretAnchorAfter,
	revealsNoMarkers,
	type LandingSegment,
	type OpaqueSegment,
	isInVisibleText
} from './painted';
import {
	type RawOffset,
	type DomTextOffset,
	toDomTextOffset,
	asRawOffset,
	toClampedRawOffset,
	asDomTextOffset
} from '../core/coordinate-spaces';
import { placeholderBreakOf } from './placeholder-break';
import { domDescendants } from './dom-descendants';
import { isLineEndingPair } from '../core/line-ending-pairs';
import type { PresentationMode } from '../presentation-mode';
import { recordCanonicalCaretCheck } from '../perf/instruments';

/** A span of a block's raw offsets. */
export interface RawRange {
	start: number;
	end: number;
}

/** The marker prefix's walk length: what a raw offset adds to become a walk offset. */
export function markerPrefixLength(container: ParentNode): number {
	return markerPrefixOf(container)?.textContent?.length ?? 0;
}

/** Whether a live `(node, offset)` position in `container` lies inside its marker prefix, where a
 *  caret never stays. */
export function isInMarkerPrefix(container: HTMLElement, node: Node, offset: number): boolean {
	return domTextOffsetAtNode(container, node, offset) < markerPrefixLength(container);
}

/** Whether the click ending a press that put the caret at `at` moves it: off a widget's side to
 *  its edge, or out of the marker prefix to the text's start. */
export function clickMovesCaret(el: HTMLElement, at: DomPosition): boolean {
	return !isInVisibleText(el, at.node) || isInMarkerPrefix(el, at.node, at.offset);
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

/** A DOM Range over raw `[start, end)` for measuring or decorating; a caret goes through the
 *  {@link CaretWriter}. From raw 0 it starts after the marker prefix span, holding whole elements. */
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

/** Where a caret at raw `raw` goes in the DOM: {@link endOfContents} when the walk finds no
 *  position at all. */
export function caretPointAtRaw(el: HTMLElement, raw: number): DomPosition {
	const pos = findDomTextOffsetTarget(el, walkOffsetOfRaw(el, Math.max(0, raw)));
	return pos ?? endOfContents(el);
}

/** The end of a container's contents, before an empty block's placeholder `<br>`. */
export function endOfContents(container: ParentNode): DomPosition {
	const br = placeholderBreakOf(container);
	const offset = br
		? Array.prototype.indexOf.call(container.childNodes, br)
		: container.childNodes.length;
	return { node: container, offset };
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

/** The DOM-walk offset of a live `(node, offset)` position: one inside a widget or a CRLF pair reads
 *  at its edge, and one outside the container as the walk's end, so check containment first. */
export function domTextOffsetAtNode(
	container: HTMLElement,
	node: Node,
	offset: number
): DomTextOffset {
	// Document order against a node outside the container is browser-specific, so such a
	// position reads as the end of the walk instead.
	const boundary = container.contains(node) ? positionBoundary(node, offset) : null;
	const mode = markerHidingMode(container);
	const segments = walkSegments(container, mode);
	let total = 0;
	let byteBefore = '';
	for (const seg of segments) {
		const segNode = seg.kind === 'text' ? seg.node : seg.el;
		if (seg.kind === 'widget' && seg.el.contains(node)) {
			return asDomTextOffset(offset === 0 ? seg.start : seg.start + seg.len);
		}
		if (segNode === node) {
			const at = seg.start + offset;
			if (seg.kind !== 'text') return asDomTextOffset(at);
			// A run of hidden marker text is opaque like a widget: every position inside it paints
			// at one pixel, so the walk reports whichever boundary the position leans toward.
			if (seg.hiddenRoot !== null) {
				return snapOutOfRun(container, at, offset === 0 ? 'before' : 'after', mode);
			}
			const data = seg.node.textContent ?? '';
			const before = offset > 0 ? data[offset - 1] : byteBefore;
			const after = offset < data.length ? data[offset] : firstTextByte(segments);
			return outsideLineEndingPair(at, before, after);
		}
		// An element-level position resolves to a segment's start, which can sit inside a merged
		// hidden run just like a text position; it leans backward, so it snaps that way.
		if (boundary && startsAtOrAfter(segNode, boundary)) {
			const snapped = snapOutOfRun(container, seg.start, 'before', mode);
			if (snapped !== seg.start || seg.kind !== 'text') return snapped;
			const after = seg.len > 0 ? seg.node.textContent![0] : firstTextByte(segments);
			return outsideLineEndingPair(seg.start, byteBefore, after);
		}
		if (seg.kind === 'widget') byteBefore = '';
		else if (seg.len > 0) byteBefore = seg.node.textContent![seg.len - 1];
		total = seg.start + seg.len;
	}
	return asDomTextOffset(total);
}

/** WebKit and Firefox let a caret stop between a `\r` and its `\n`, where Chromium never does: such
 *  a position reads as the line's end, before the pair, so no edit splits it. */
function outsideLineEndingPair(at: number, before: string, after: string): DomTextOffset {
	return asDomTextOffset(isLineEndingPair(before, after) ? at - 1 : at);
}

/** The first byte of the walk's next non-empty text, or '' at a widget or the walk's end. */
function firstTextByte(rest: Iterator<WalkSegment>): string {
	for (let next = rest.next(); !next.done; next = rest.next()) {
		const seg = next.value;
		if (seg.kind === 'widget') return '';
		if (seg.len > 0) return seg.node.textContent![0];
	}
	return '';
}

export interface DomPosition {
	node: Node;
	offset: number;
}

/** A DOM-walk offset back to a live `(node, offset)` position, the DOM side of `findNodeAtOffset`
 *  in `core/inline-render.ts`. Works on a detached fragment the same way. */
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
	const landing = landingIgnoringPendingBreak(container, target);
	if (!landing) return null;
	const onLine = ontoPendingBreakLine(landing.position, container);
	return onLine === landing.position ? landing : { position: onLine, inTextAtTarget: false };
}

/** A position a pending hard break's line follows sits on that line, before its last anchor: while
 *  the break is open, Backspace and ArrowLeft end it before a caret could sit at the text's end. */
function ontoPendingBreakLine(position: DomPosition, root: ParentNode): DomPosition {
	let next = nodeAfter(position, root);
	if (!isBreakAnchor(next)) return position;
	let last: Node | null = null;
	for (; isBreakAnchor(next); next = next!.nextSibling) last = next;
	if (!last?.parentNode) return position;
	return {
		node: last.parentNode,
		offset: Array.prototype.indexOf.call(last.parentNode.childNodes, last)
	};
}

/** The node right after `position`, at whatever depth, past empty text; null when nothing follows
 *  before the end of `root` or the position sits inside a text node's text. */
function nodeAfter({ node, offset }: DomPosition, root: ParentNode): Node | null {
	let from: Node;
	if (node.nodeType === Node.TEXT_NODE) {
		if (offset < (node.textContent?.length ?? 0)) return null;
		from = node;
	} else {
		const child = node.childNodes[offset];
		if (child) return skipEmptyText(child);
		from = node;
	}
	for (let at: Node | null = from; at && at !== root; at = at.parentNode) {
		const next = skipEmptyText(at.nextSibling);
		if (next) return next;
	}
	return null;
}

function skipEmptyText(node: Node | null): Node | null {
	let at = node;
	while (at?.nodeType === Node.TEXT_NODE && (at.textContent?.length ?? 0) === 0)
		at = at.nextSibling;
	return at;
}

function landingIgnoringPendingBreak(
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
	// A text node ending in a line break at the target: the next text's start, if it starts there.
	let endsLine: Text | null = null;
	for (const seg of landingSegments(container, markerHidingMode(container))) {
		if (seg.kind === 'text') {
			if (endsLine && seg.len === 0) continue;
			if (endsLine && seg.start === target) {
				return { position: { node: seg.node, offset: 0 }, inTextAtTarget: true };
			}
			if (endsLine) break;
			const end = seg.start + seg.len;
			// WebKit and Firefox draw a caret after a node's final `\n` on the line it ends.
			if (end === target && seg.len > 0 && (seg.node as Text).data.endsWith('\n')) {
				endsLine = seg.node as Text;
				continue;
			}
			if (end >= target) {
				return { position: { node: seg.node, offset: target - seg.start }, inTextAtTarget: true };
			}
			last = { node: seg.node, offset: seg.len };
			continue;
		}
		if (endsLine) break;
		// The caret cannot sit inside an opaque span: a target at its edge lands beside it, one
		// inside lands past it (a widget that can show its source opens before this write).
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
	if (endsLine) {
		return { position: { node: endsLine, offset: endsLine.length }, inTextAtTarget: true };
	}
	if (prefix && last && prefix.contains(last.node)) last = positionAfterPrefix(container, prefix);
	return last && { position: last, inTextAtTarget: false };
}

/** The atomic inline widgets intersecting the DOM-walk range [start, end): a widget adds no text,
 *  so a caller covering it takes its bounding box. Positions are walk offsets, never `data-source-*`. */
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

/** A block's text as the screen shows it, each character with the raw span it stands for. */
export interface VisibleText {
	text: string;
	rawStart: number[];
	rawEnd: number[];
}

/** The text a rule that reads words across hidden markers sees: the marker text the mode hides and
 *  the container's marker prefix left out, an atomic widget as one U+FFFC. */
export function visibleWalkText(container: ParentNode): VisibleText {
	const visible: VisibleText = { text: '', rawStart: [], rawEnd: [] };
	const prefix = markerPrefixOf(container);
	const prefixLength = markerPrefixLength(container);
	const raw = (walk: number) => toClampedRawOffset(asDomTextOffset(walk), prefixLength);
	for (const seg of walkSegments(container, markerHidingMode(container))) {
		if (seg.kind === 'widget') {
			visible.text += '￼';
			visible.rawStart.push(raw(seg.start));
			visible.rawEnd.push(raw(seg.start + seg.len));
			continue;
		}
		if (seg.hiddenRoot !== null || prefix?.contains(seg.node)) continue;
		const data = seg.node.textContent ?? '';
		visible.text += data;
		for (let i = 0; i < data.length; i++) {
			visible.rawStart.push(raw(seg.start + i));
			visible.rawEnd.push(raw(seg.start + i + 1));
		}
	}
	return visible;
}

/** The first visible character at or after raw `raw`. */
export function visibleIndexAt(visible: VisibleText, raw: number): number {
	const i = visible.rawStart.findIndex((start) => start >= raw);
	return i === -1 ? visible.text.length : i;
}

/** How many visible characters end at or before raw `raw`. */
export function charsEndingBy(visible: VisibleText, raw: number): number {
	const i = visible.rawEnd.findIndex((end) => end > raw);
	return i === -1 ? visible.text.length : i;
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

/** The DOM-walk span of the atomic widget strictly containing `offset`, or null in text or on a
 *  boundary. A replace decoration snaps outward with it, since a range cannot split a widget. */
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
		const end = endOfContents(container);
		range.setStart(end.node, end.offset);
		range.collapse(true);
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

/** The first and last walk offsets a caret can sit at, past hidden marker runs and the marker
 *  prefix; the checks at a block's edge read these. All-hidden text answers `{len, len}`. */
export function reachableDomTextBounds(container: ParentNode): {
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
		if (seg.kind === 'opaque' && seg.hidden && seg.first.hasAttribute(BLOCK_SUFFIX_ATTR)) {
			// Nothing past a block's trailing structure is text, and an emptied block's caret
			// sits before that structure.
			if (!landed) end = start;
			break;
		}
		if (seg.kind === 'opaque' ? seg.hidden : inMarkerPrefix(seg.node, container)) {
			if (!landed) start = stop;
			continue;
		}
		landed = true;
		end = stop;
		lastText = seg.kind === 'text' ? seg.node : null;
	}
	// The browser puts no caret after the last text's final `\n`, so an end check reading that
	// position would never fire; a caret anchor paints the line and keeps the position.
	if (lastText?.textContent?.endsWith('\n') && !caretAnchorAfter(lastText, container)) {
		end -= 1;
	}
	return { start: asDomTextOffset(start), end: asDomTextOffset(Math.max(start, end)) };
}

/** {@link reachableDomTextBounds} in raw offsets, or null where the markers paint and all of raw is
 *  reachable. Every caret check and placement reads this one answer. */
export function reachableRawBounds(el: HTMLElement): RawRange | null {
	if (!revealsNoMarkers(el)) return null;
	const bounds = reachableDomTextBounds(el);
	const prefixLength = markerPrefixLength(el);
	return {
		start: toClampedRawOffset(bounds.start, prefixLength),
		end: toClampedRawOffset(bounds.end, prefixLength)
	};
}

/** Clamp a caret offset into the range the caret can sit in; a no-op wherever the markers paint. */
export function clampToReachableRaw(el: HTMLElement, offset: number): number {
	const bounds = reachableRawBounds(el);
	if (!bounds) return offset;
	return Math.min(Math.max(offset, bounds.start), bounds.end);
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

/** The start of the hidden run ending at walk offset `at`, when content before it on its line gives
 *  that start a pixel of its own; `at` otherwise. */
export function nearSideOfRunEndingAt(
	container: ParentNode,
	at: DomTextOffset,
	mode: PresentationMode
): DomTextOffset {
	recordCanonicalCaretCheck('caretCanonicalWalks');
	let before: LandingSegment | null = null;
	for (const seg of landingSegments(container, mode)) {
		if (seg.start + seg.len > at) break;
		if (seg.kind === 'opaque' && seg.hidden && seg.len > 0 && seg.start + seg.len === at) {
			if (!before || (before.kind === 'opaque' && before.hidden)) return at;
			const text = before.kind === 'text' ? (before.node.textContent ?? '') : '';
			const lineStart =
				before.kind === 'text' && (text.endsWith('\n') || inMarkerPrefix(before.node, container));
			return lineStart || runEndsOnAnotherLine(container, seg, mode)
				? at
				: asDomTextOffset(seg.start);
		}
		if (seg.len > 0) before = seg;
	}
	return at;
}

/** Whether a hidden run's far side is on a line of its own: the run holds a line break (a setext
 *  underline), or a pending hard break's line starts right after it. */
function runEndsOnAnotherLine(
	container: ParentNode,
	run: OpaqueSegment,
	mode: PresentationMode
): boolean {
	const after = positionBeside(run.last, 'after');
	if (after && isBreakAnchor(nodeAfter(after, container))) return true;
	for (const seg of walkSegments(container, mode)) {
		if (seg.start >= run.start + run.len) break;
		if (seg.kind === 'text' && seg.start >= run.start && seg.node.textContent!.includes('\n')) {
			return true;
		}
	}
	return false;
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
	// A span right after a pending hard break's anchors (a setext underline) starts past the line
	// they open, so the position before it is on that line.
	if (side === 'before' && isBreakAnchor(sibling) && isBreakAnchor(sibling!.previousSibling)) {
		return { node: parent, offset: idx - 1 };
	}
	return { node: parent, offset: side === 'before' ? idx : idx + 1 };
}

/** A DOM position as a document-order landmark, so a walk finds it without a parallel descent;
 *  text positions need none, being segments of their own or inside a widget. */
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
