/**
 * Double and triple click: the second click of a run selects the word under it, the third the
 * whole block's text, and a drag from either grows by that unit. The editor owns the gesture
 * from the second click so the browser paints nothing of its own: its word rule varies by
 * platform, it walks into non-editable widgets, and a marker here never joins a word.
 */

import { ambientLengthOf } from '../ambient/ambient-dom';
import {
	asDomTextOffset,
	asRawOffset,
	toClampedRawOffset,
	toDomTextOffset
} from '../cursor/coordinate-spaces';
import { caretOffsetAtPoint } from '../cursor/point-offset';
import type { UserScrollport } from '../cursor/scroll-ancestors';
import { containerDomTextLength, maskedWalkText } from '../cursor/widget-offset';
import { isWholeBlockInputProxy } from '../editor-actions/whole-block-focus-surface';
import type { BlockElLookup } from '../editor-keys';
import { installDragListener, type DragGranularity } from './drag-pointer';
import { applySingleBlockRange, applySurfaceContentRange } from './native-bridge';
import { blockNearPoint } from './nearest-block';
import type { SelectionEndpoint, SelectionPoint } from './primitives';
import type { SelectionState } from './selection-state.svelte';

export type ClickGranularity = 'word' | 'block';

export interface Span {
	start: number;
	end: number;
}

// ── The word rule ────────────────────────────────────────────────────────────

let segmenter: Intl.Segmenter | null | undefined;

function wordSegmenter(): Intl.Segmenter | null {
	if (segmenter === undefined) {
		segmenter =
			typeof Intl.Segmenter === 'function'
				? new Intl.Segmenter(undefined, { granularity: 'word' })
				: null;
	}
	return segmenter;
}

/**
 * [start, end) of the segment at `offset` in `text`: the word ending there when it is one, else
 * the segment starting there (whitespace or punctuation, as the browser would take). Null on
 * empty text, or on a platform with no segmenter.
 */
export function wordSpanAt(text: string, offset: number): Span | null {
	const seg = wordSegmenter();
	if (!seg || text.length === 0) return null;
	const segments = seg.segment(text);
	const at = Math.max(0, Math.min(offset, text.length));
	const left = at > 0 ? segments.containing(at - 1) : undefined;
	const right = at < text.length ? segments.containing(at) : undefined;
	if (left && right && left.index === right.index) return spanOf(left);
	if (left?.isWordLike) return spanOf(left);
	const pick = right ?? left;
	return pick ? spanOf(pick) : null;
}

function spanOf(segment: Intl.SegmentData): Span {
	return { start: segment.index, end: segment.index + segment.segment.length };
}

/** The raw span `granularity` takes around a raw offset in `surface`; null where the word rule
 *  has nothing to read. */
export function spanAround(
	surface: HTMLElement,
	granularity: ClickGranularity,
	rawOffset: number
): Span | null {
	const ambient = ambientLengthOf(surface);
	if (granularity === 'block') {
		return { start: 0, end: toClampedRawOffset(containerDomTextLength(surface), ambient) };
	}
	const walk = toDomTextOffset(asRawOffset(rawOffset), ambient);
	const span = wordSpanAt(maskedWalkText(surface), walk);
	if (!span) return null;
	return {
		start: toClampedRawOffset(asDomTextOffset(span.start), ambient),
		end: toClampedRawOffset(asDomTextOffset(span.end), ambient)
	};
}

/** The unit a click count selects; a run stays at the block unit past three clicks. */
export function granularityForClickCount(clickCount: number): ClickGranularity | null {
	if (clickCount === 2) return 'word';
	return clickCount >= 3 ? 'block' : null;
}

// ── The gesture ──────────────────────────────────────────────────────────────

export interface MultiClickDeps {
	editorRoot: HTMLElement;
	selection: SelectionState;
	getBlockElByPath: BlockElLookup;
	getScrollContainer(): UserScrollport;
	lifetimeSignal?: AbortSignal;
	/** A click outside every editable element (the margin, a container's own box) names the
	 *  nearest block, as a single click there does; null when the click is on a button or handle. */
	marginBlockAt(target: EventTarget | null, clientX: number, clientY: number): number[] | null;
}

/**
 * Root listeners for the gesture. The click count comes from mousedown (a pointer event
 * carries none) and the drag from the pointerdown of the same click, so both are listened to.
 * The mousedown is cancelled, never the pointerdown (that would silence the click), and so is
 * the mouseup: on release the browser would put a caret where a click landed off a glyph,
 * over the range just painted.
 */
export function installMultiClickSelect(deps: MultiClickDeps): () => void {
	let lastPointerDown: PointerEvent | null = null;
	let claimed = false;
	const onPointerDown = (e: PointerEvent) => {
		lastPointerDown = e;
	};
	const onMouseUp = (e: MouseEvent) => {
		if (claimed) e.preventDefault();
	};
	const onMouseDown = (e: MouseEvent) => {
		claimed = false;
		const granularity = granularityForClickCount(e.detail);
		if (!granularity || e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
		if (pressesInlineWidget(e.target)) return;
		const press = pressedSurface(deps, e);
		if (!press) return;
		const anchorSpan = selectAtPoint(press.surface, granularity, e.clientX, e.clientY);
		if (!anchorSpan) return;
		e.preventDefault();
		claimed = true;
		const anchor =
			press.anchor ?? blockNearPoint(deps.editorRoot, e.clientX, e.clientY)?.endpointHere();
		if (!anchor || !lastPointerDown) return;
		installDragListener(
			{
				editorRoot: deps.editorRoot,
				scrollContainer: deps.getScrollContainer(),
				selection: deps.selection,
				getBlockElByPath: deps.getBlockElByPath,
				lifetimeSignal: deps.lifetimeSignal,
				granularity: createGranularity(
					deps.getBlockElByPath,
					press.surface,
					granularity,
					anchorSpan
				)
			},
			anchor,
			lastPointerDown
		);
	};
	deps.editorRoot.addEventListener('pointerdown', onPointerDown);
	deps.editorRoot.addEventListener('mousedown', onMouseDown);
	deps.editorRoot.addEventListener('mouseup', onMouseUp);
	return () => {
		deps.editorRoot.removeEventListener('pointerdown', onPointerDown);
		deps.editorRoot.removeEventListener('mousedown', onMouseDown);
		deps.editorRoot.removeEventListener('mouseup', onMouseUp);
	};
}

/** The editable element a click selects in: the one under it, else the nearest block's, the
 *  way a single click in the margin lands there. A block with no text has no word to select. */
function pressedSurface(
	deps: MultiClickDeps,
	e: MouseEvent
): { surface: HTMLElement; anchor: SelectionEndpoint | null } | null {
	// Up through a non-editable span inside the editable (a list's `- ` prefix) to the editable.
	const own = surfaceOf(e.target);
	if (own) return isWholeBlockInputProxy(own) ? null : { surface: own, anchor: null };
	const path = deps.marginBlockAt(e.target, e.clientX, e.clientY);
	const block = path && deps.getBlockElByPath(path);
	if (!block) return null;
	// A container's own box (a quote's gutter) selects in the leaf nearest the click, the way a
	// click beside a line lands in that line.
	const surface = block.contentEditable === 'true' ? block : nearestSurfaceIn(block, e.clientY);
	const surfacePath = surface && pathOfSurface(surface);
	const offset = surface && caretOffsetAtPoint(surface, e.clientX, e.clientY);
	if (!surface) return null;
	return { surface, anchor: surfacePath && offset !== null ? { path: surfacePath, offset } : null };
}

function nearestSurfaceIn(block: HTMLElement, clientY: number): HTMLElement | null {
	let best: HTMLElement | null = null;
	let bestDistance = Infinity;
	for (const el of block.querySelectorAll<HTMLElement>('[contenteditable="true"]')) {
		const rect = el.getBoundingClientRect();
		const distance = clientY < rect.top ? rect.top - clientY : Math.max(0, clientY - rect.bottom);
		if (distance < bestDistance) {
			best = el;
			bestDistance = distance;
		}
	}
	return best;
}

/** The path of the block this editable element is the text of; null for one addressed some
 *  other way (a table's cell), whose drag is not a character drag. */
function pathOfSurface(surface: HTMLElement): number[] | null {
	const host = surface.closest<HTMLElement>('[data-block-path]');
	const raw = host?.getAttribute('data-block-path');
	if (!raw || !host?.contains(surface)) return null;
	const path = JSON.parse(raw) as number[];
	return host.querySelector('[contenteditable="true"]') === surface ? path : null;
}

/** Selects the unit's span at the click and returns it, in raw offsets. */
function selectAtPoint(
	surface: HTMLElement,
	granularity: ClickGranularity,
	clientX: number,
	clientY: number
): Span | null {
	if (granularity === 'block') {
		applySurfaceContentRange(surface);
		return spanAround(surface, 'block', 0);
	}
	const offset = caretOffsetAtPoint(surface, clientX, clientY);
	const span = offset === null ? null : spanAround(surface, 'word', offset);
	if (!span || span.start === span.end) return null;
	applySingleBlockRange(surface, span.start, span.end);
	return span;
}

function createGranularity(
	getBlockElByPath: BlockElLookup,
	surface: HTMLElement,
	granularity: ClickGranularity,
	anchorSpan: Span
): DragGranularity {
	return {
		surface,
		anchorSpan,
		spanAround: (offset) =>
			spanAround(surface, granularity, offset) ?? { start: offset, end: offset },
		expandFocus: (point: SelectionPoint, side): SelectionEndpoint => {
			const el = point.cellCoordinate ? null : getBlockElByPath(point.path);
			const span = el && spanAround(el, granularity, point.offset);
			if (!span) return point;
			return { path: point.path.slice(), offset: side === 'after' ? span.end : span.start };
		}
	};
}

/** A click on an inline widget is that widget's own gesture (a footnote's double-click takes
 *  its whole token), so it is left alone here. */
function pressesInlineWidget(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest('[data-inline-widget]') !== null;
}

function surfaceOf(target: EventTarget | null): HTMLElement | null {
	let el = target instanceof HTMLElement ? target : null;
	while (el && el.contentEditable !== 'true') el = el.parentElement;
	return el;
}
