/**
 * How a block's rendered DOM reads against what the screen shows: which text is hidden marker
 * text, which spans a caret may not enter, and the segments every offset walk reads. Decided
 * from the families in `core/inline/visibility.ts`, not from layout; that file and
 * `styles/editor.css` change together.
 */

import {
	isMarkerPrefixSpan,
	markerFamilyOf,
	type VisibilityContext,
	screenVisibility,
	familyPaintsAlone,
	type MarkerFamily,
	familyHidesText,
	previewInlineReveal
} from '../core/inline/visibility';
import { recordCanonicalCaretCheck } from '../perf/instruments';
import { splitsLineEndingPair } from '../core/line-ending-pairs';
import {
	hidesDelimitersAtCaret,
	type PresentationMode,
	asPresentationMode,
	hidesMarkers
} from '../presentation-mode';
import { widgetSourceRange } from '../core/inline/widget-shell';

/** Marks the span holding a block's bytes past its content: a setext underline, or an ATX
 *  heading's closing run. Its value is `after-prefix` when the block also drew a prefix span. */
export const BLOCK_SUFFIX_ATTR = 'data-block-suffix';

/** Marks the span holding a block's own marker before its content, a heading's `# `. */
export const BLOCK_PREFIX_ATTR = 'data-block-prefix';

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

/** Whether a caret position has a shape the editor never writes. Climbs only as far as `el`: that
 *  climb is what a caret in plain text pays on every key. */
export function mayBeOffCanonical(el: HTMLElement, node: Node, offset: number): boolean {
	let inMarker = false;
	for (let at: Node | null = node; at && at !== el; at = at.parentNode) {
		recordCanonicalCaretCheck('caretCanonicalSteps');
		if (isAtomicInlineWidget(at)) return true;
		if (at instanceof Element && markerFamilyOf(at) !== null) inMarker = true;
	}
	if (node instanceof Text) {
		if (splitsLineEndingPair(node.data, offset)) return true;
		if (offset > 0 && !inMarker) return false;
	}
	return revealsNoMarkers(el);
}

const WIDGET_ATTR = 'data-inline-widget';

/** Written on the editable element while {@link holdsOnlyMarkerChrome} holds, and read by this walk
 *  and `styles/editor.css`. Written in every mode, so a mode switch never finds it stale. */
export const CONTENT_EMPTY_ATTR = 'data-content-empty';

/** Set on the editable element of a row that shows its source while the caret is in it (a `:::`
 *  container's opener line); read by this walk and `styles/editor.css` like the attribute above. */
export const SOURCE_AT_CARET_ATTR = 'data-source-at-caret';

/** The class the preview-inline reveal trigger sets and this walk's hiding rule reads, defined
 *  once so the two sides cannot drift. */
export const CONSTRUCT_REVEAL_CLASS = 'md-construct-reveal';

/** The text length of a block's trailing structure span (`BLOCK_SUFFIX_ATTR`) where the mode
 *  hides it, else 0: bytes a range the user drew cannot have meant to take. */
export function hiddenSuffixLength(el: HTMLElement): number {
	// Not always the last child: a pending hard break's anchors follow a closing run.
	const text = el.querySelector(`:scope > [${BLOCK_SUFFIX_ATTR}]`)?.firstChild ?? null;
	return text && isHiddenMarkerText(text, el) ? (text.textContent?.length ?? 0) : 0;
}

/** Whether `node` is marker text the mode's CSS paints nothing for, decided from the families in
 *  `core/inline/visibility.ts`, not layout; that file and `styles/editor.css` change together. */
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

/** Whether `node` is text the block lays out as its own lines: not hidden marker text, and not in
 *  the marker prefix, which sits in the hanging indent beside whatever line comes first. */
export function isBlockLineText(node: Node, container: HTMLElement): boolean {
	if (isHiddenMarkerText(node, container)) return false;
	return !markerPrefixOf(container)?.contains(node);
}

/** The element form of {@link isHiddenMarkerText}, for a walk that treats such a span as opaque
 *  instead of descending into it. */
export function isHiddenMarkerRoot(el: Element, container: HTMLElement): boolean {
	if (el === container || !container.contains(el)) return false;
	const mode = markerHidingMode(container);
	return mode !== null && hidesOwnText(el, mode, chromeStandsAloneUnder(container, mode));
}

/** `hidesDelimitersAtCaret` read from the DOM: whether this container's mode paints no marker in
 *  the focused block. No mode attribute means styled source, which paints. */
export function revealsNoMarkers(container: ParentNode): boolean {
	const mode = markerHidingMode(container);
	return mode !== null && hidesDelimitersAtCaret(mode);
}

/** The screen a block's edge rules read, or null where its mode paints the markers at the caret
 *  and every delimiter is a byte the user can see. */
export function hidingScreenOf(el: HTMLElement | null): VisibilityContext | null {
	return el && revealsNoMarkers(el) ? screenVisibilityOf(el) : null;
}

/** How this container's bytes read on screen, its mode plus its content-empty attribute, so a text
 *  rewrite needs no marker knowledge of its own. An unmounted block reads as source. */
export function screenVisibilityOf(container: ParentNode | null): VisibilityContext {
	return screenVisibility(
		container === null ? 'source' : (markerHidingMode(container) ?? 'source'),
		{ chromePaints: container instanceof Element && chromeStampPaints(container) }
	);
}

/** The stylesheet's condition for painting an empty construct's or a source-at-caret row's markers:
 *  the attribute plus focus inside, read by containment because jsdom lacks `:focus-within`. */
function chromeStampPaints(container: Element): boolean {
	if (
		!container.hasAttribute(CONTENT_EMPTY_ATTR) &&
		!container.hasAttribute(SOURCE_AT_CARET_ATTR)
	) {
		return false;
	}
	const active = container.ownerDocument.activeElement;
	return active !== null && container.contains(active);
}

/** A `<br>` that gives the caret a line nothing else paints, adding no text. `role` tells the walks
 *  a hidden fence closer line (`closer`) from a pending hard break's line (`break`). */
export function createCaretAnchor(role: '' | 'closer' | 'break' = ''): HTMLBRElement {
	const anchor = document.createElement('br');
	anchor.dataset.caretAnchor = role;
	return anchor;
}

/** The next painted node after `text`, at any depth above it, when it is a caret anchor. */
export function caretAnchorAfter(text: Node, root: ParentNode): HTMLElement | null {
	for (let node: Node | null = text; node && node !== root; node = node.parentNode) {
		let next = node.nextSibling;
		while (next?.nodeType === Node.TEXT_NODE && (next.textContent?.length ?? 0) === 0) {
			next = next.nextSibling;
		}
		if (!next) continue;
		if (!(next instanceof HTMLElement)) return null;
		return next.tagName === 'BR' && 'caretAnchor' in next.dataset ? next : null;
	}
	return null;
}

/** The container's bytes outside its markers, whatever the mode paints. An empty fence body answers
 *  whitespace: nothing for Backspace to delete but the block itself. */
export function chromeFreeText(container: ParentNode): string {
	let text = '';
	for (const seg of walkSegments(container, null)) {
		if (seg.kind !== 'text' || seg.len === 0) continue;
		if (markerRootOf(seg.node, container) !== null) continue;
		text += seg.node.textContent ?? '';
	}
	return text;
}

/** Whether every byte is marker text, with a span the empty-construct override paints: the
 *  `data-content-empty` condition, computed without reading the attribute it sets. */
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

/** Whether `node` sits inside an atomic inline widget under `root`, where a caret is no caret of
 *  the editor's: the browser can leave one there, but no key types into it. */
export function isInsideAtomicWidget(root: ParentNode, node: Node): boolean {
	for (let at: Node | null = node; at && at !== root; at = at.parentNode) {
		if (isAtomicInlineWidget(at)) return true;
	}
	return false;
}

/** Whether `node` is an atomic inline widget's element, which every walk treats as opaque. Checks
 *  the attribute rather than a selector because every walk asks this per node. */
export function isAtomicInlineWidget(node: Node): boolean {
	return node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute(WIDGET_ATTR);
}

const FOCUSED_HOST_SELECTOR = '.block-host[data-focused]';

/** The editor root's mode when it hides markers; null in source mode, which sets no attribute,
 *  and for a detached build with no root to read. */
export function markerHidingMode(container: ParentNode): PresentationMode | null {
	if (!(container instanceof Element)) return null;
	const mode = asPresentationMode(
		container.closest('[data-presentation]')?.getAttribute('data-presentation')
	);
	return hidesMarkers(mode) ? mode : null;
}

/** The nearest ancestor between `node` and `root` whose own text is a marker, with the family
 *  that decides what the empty-container override does with it. */
export function markerRootOf(
	node: Node,
	root: ParentNode
): { el: Element; family: MarkerFamily } | null {
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
export function inMarkerPrefix(node: Node, root: ParentNode): boolean {
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
	const revealed = el.classList.contains(CONSTRUCT_REVEAL_CLASS);
	const reveal = previewInlineReveal(family);
	if (reveal === 'focus') return false;
	if (reveal === 'class') return !revealed;
	return el.hasAttribute('data-construct-start') && !revealed;
}

/** Whether two neighbouring hidden runs are a block's marker span and its trailing structure. */
function prefixMeetsSuffix(from: Element, to: Element): boolean {
	return from.hasAttribute(BLOCK_PREFIX_ATTR) && to.hasAttribute(BLOCK_SUFFIX_ATTR);
}

/** Whether a pending hard break's anchor stands between two sibling spans. */
function breakAnchorBetween(from: Element, to: Element): boolean {
	for (let node = from.nextSibling; node && node !== to; node = node.nextSibling) {
		if (isBreakAnchor(node)) return true;
	}
	return false;
}

export function isBreakAnchor(node: Node | null): boolean {
	return (
		node instanceof HTMLElement && node.tagName === 'BR' && node.dataset.caretAnchor === 'break'
	);
}

export type WalkSegment =
	| { kind: 'text'; node: Node; start: number; len: number; hiddenRoot: Element | null }
	| { kind: 'widget'; el: Element; start: number; len: number };

/** The segments every walk reader shares: text counts its length, an atomic widget its raw source
 *  length, any other element nothing. Hidden marker text counts too, with the span that hides it. */
export function* walkSegments(
	root: ParentNode,
	mode: PresentationMode | null
): Generator<WalkSegment> {
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

export type LandingSegment =
	| { kind: 'text'; node: Node; start: number; len: number }
	| {
			kind: 'opaque';
			hidden: boolean;
			first: Element;
			last: Element;
			start: number;
			len: number;
	  };

export type OpaqueSegment = Extract<LandingSegment, { kind: 'opaque' }>;

/** A new opaque span is one element, its own first and last, until a run extends it. */
function opaqueSegment(el: Element, start: number, len: number, hidden: boolean): OpaqueSegment {
	return { kind: 'opaque', hidden, first: el, last: el, start, len };
}

/** The walk as the caret sees it: text it can sit in, and opaque spans it may not enter. Adjacent
 *  hidden spans merge, since snapping from one into the next still leaves the caret unpainted. */
export function* landingSegments(
	root: ParentNode,
	mode: PresentationMode | null
): Generator<LandingSegment> {
	let run: OpaqueSegment | null = null;
	for (const seg of walkSegments(root, mode)) {
		// A node contributing nothing cannot end a run: Chromium leaves empty text nodes between
		// spans, and splitting the run there would create a caret position nothing paints.
		if (run && seg.len === 0) continue;
		if (seg.kind === 'text' && seg.hiddenRoot !== null) {
			// A pending hard break's anchors start a line between two hidden runs (a closer ending the
			// text, a setext underline), and the caret sits at that line's start.
			if (run && breakAnchorBetween(run.last, seg.hiddenRoot)) {
				yield run;
				run = null;
			}
			// An emptied heading's text sits between its marker and its closing run, where the
			// caret goes, so the two hidden runs stay apart.
			if (run && prefixMeetsSuffix(run.last, seg.hiddenRoot)) {
				yield run;
				run = null;
			}
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

function widgetRawLength(el: Element): number {
	const range = widgetSourceRange(el);
	return range ? Math.max(0, range.end - range.start) : 0;
}

/** Whether `node` is text in `el` the user sees and types into: hidden marker text paints
 *  nothing, and a widget's own text paints but takes no typing. */
export function isInVisibleText(el: HTMLElement, node: Node): boolean {
	if (node.nodeType !== Node.TEXT_NODE || !el.contains(node)) return false;
	return !isHiddenMarkerText(node, el) && !isInsideAtomicWidget(el, node);
}
