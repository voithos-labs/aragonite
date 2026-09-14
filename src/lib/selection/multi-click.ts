/**
 * The click ladder past the caret: the second press of a run selects the word under it, the
 * third the surface's content, and a drag from either extends at that granularity. Owned from
 * the second press, so the browser paints nothing of its own: its word rule is per platform,
 * its walk enters atomic islands, and a marker here never joins a word.
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
 * the segment starting there (whitespace or punctuation, as the engine would take). Null on
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

/** The rung a press's click count reaches; the run stays at the block rung past three. */
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
	/** A press outside every editable surface (the margin, a container's own box) names the
	 *  nearest block, as a single click there does; null where the press is chrome's. */
	marginBlockAt(target: EventTarget | null, clientX: number, clientY: number): number[] | null;
}

/**
 * Root listeners for the ladder. The count rides the mousedown (a pointer event carries none),
 * and the drag rides the pointerdown of the same press, so both are heard. The mousedown is
 * cancelled, never the pointerdown (that would silence the click), and so is the mouseup: the
 * browser's release seats a caret at a press that landed off a glyph, over the range just painted.
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

/** The surface a press selects in: the editable under it, else the nearest block's, the way a
 *  single click in the margin lands there. A block with no text surface is nobody's word. */
function pressedSurface(
	deps: MultiClickDeps,
	e: MouseEvent
): { surface: HTMLElement; anchor: SelectionEndpoint | null } | null {
	// Up through an island inside the editable (a list's `- ` prefix) to the surface itself.
	const own = surfaceOf(e.target);
	if (own) return isWholeBlockInputProxy(own) ? null : { surface: own, anchor: null };
	const path = deps.marginBlockAt(e.target, e.clientX, e.clientY);
	const block = path && deps.getBlockElByPath(path);
	if (!block) return null;
	// A container's own box (a quote's gutter) selects in the leaf nearest the press, the way a
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

/** The path of the block a surface is the content of; null for a surface addressed some other
 *  way (a table's cell), whose drag is not a char-point drag. */
function pathOfSurface(surface: HTMLElement): number[] | null {
	const host = surface.closest<HTMLElement>('[data-block-path]');
	const raw = host?.getAttribute('data-block-path');
	if (!raw || !host?.contains(surface)) return null;
	const path = JSON.parse(raw) as number[];
	return host.querySelector('[contenteditable="true"]') === surface ? path : null;
}

/** Paint the rung's span at the press and answer it, in raw offsets. */
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

/** A press on an inline widget is that widget's own gesture (a footnote's double-click takes
 *  its whole token), so the ladder leaves it alone. */
function pressesInlineWidget(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest('[data-inline-widget]') !== null;
}

function surfaceOf(target: EventTarget | null): HTMLElement | null {
	let el = target instanceof HTMLElement ? target : null;
	while (el && el.contentEditable !== 'true') el = el.parentElement;
	return el;
}
