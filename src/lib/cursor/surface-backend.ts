/**
 * Caret reads and writes for an editable block element, in raw offsets, over the one offset walk
 * in `widget-offset.ts`. Every editable surface (prose, code, table cell, plugin leaf) builds one.
 * Reads answer only while the element holds focus.
 */

import { asRawOffset, type RawOffset } from './coordinate-spaces';
import {
	domTextOffsetAtNode,
	markerPrefixLength,
	markerPrefixOf,
	placeCaretAtRaw,
	rawOffsetAt,
	rawSelectionFocus,
	type CaretClamp
} from './widget-offset';

export interface SurfaceBackendDeps {
	getEl: () => HTMLElement | null;
	/**
	 * Where the user meant the caret, in raw units, when the browser holds no usable range:
	 * Chromium drops an element-level caret beside an atomic widget across an event-loop yield.
	 * Null when no such intent is recorded.
	 */
	getSnapTarget?: () => number | null;
}

/** The caret calls the editable-surface factory needs from a block. */
export interface CursorBackend {
	/** Raw offset of the caret (the range start), or null when the element does not hold focus. */
	getRaw(): RawOffset | null;
	/** Place a collapsed caret; `clamp` says whether the offset may move onto a position the
	 *  caret can reach. */
	setRaw(offset: RawOffset, placement: { clamp: CaretClamp }): void;
}

export interface SurfaceBackend extends CursorBackend {
	/** Raw offset of the selection's moving end, or null when it sits outside the element. */
	getFocusOffset(): RawOffset | null;
	/** Raw offsets of the selection's start and end, or null for a caret or an unfocused element. */
	getRawSelection(): { start: RawOffset; end: RawOffset } | null;
	/** Raw offsets of an arbitrary range inside the element: an InputEvent's target range, which a
	 *  word delete reports at a collapsed caret, so the selection cannot answer it. */
	rawRangeOf(range: AbstractRange): { start: RawOffset; end: RawOffset } | null;
	/** Move a focused caret that sits inside the marker prefix to raw 0, just past the prefix. */
	clampOutOfMarkerPrefix(): void;
}

export function createSurfaceBackend(deps: SurfaceBackendDeps): SurfaceBackend {
	function snapTargetRaw(): RawOffset | null {
		const target = deps.getSnapTarget?.() ?? null;
		return target === null ? null : asRawOffset(target);
	}

	function getRaw(): RawOffset | null {
		const live = readLiveRange(deps.getEl());
		if (live.state === 'inactive') return null;
		// A dropped range, or one bounced into the read-only prefix: the snap target holds where the
		// user meant the caret.
		if (live.state === 'dropped' || live.inPrefix(live.range.startContainer))
			return snapTargetRaw();
		return rawOffsetAt(live.el, live.range.startContainer, live.range.startOffset);
	}

	function setRaw(offset: RawOffset, placement: { clamp: CaretClamp }): void {
		const el = deps.getEl();
		if (el) placeCaretAtRaw(el, offset, placement);
	}

	function getFocusOffset(): RawOffset | null {
		const el = deps.getEl();
		return el ? rawSelectionFocus(el) : null;
	}

	function getRawSelection(): { start: RawOffset; end: RawOffset } | null {
		const live = readLiveRange(deps.getEl());
		if (live.state !== 'live' || live.collapsed) return null;
		// No snap-target fallback: one caret intent cannot stand in for one end of a pair, and an
		// endpoint inside the prefix already reads as raw 0.
		return rawEndpointsOf(live.el, live.range);
	}

	function rawRangeOf(range: AbstractRange): { start: RawOffset; end: RawOffset } | null {
		const el = deps.getEl();
		if (!el || !el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
		return rawEndpointsOf(el, range);
	}

	function clampOutOfMarkerPrefix(): void {
		const live = readLiveRange(deps.getEl());
		if (live.state !== 'live' || !live.collapsed) return;
		const { startContainer, startOffset } = live.range;
		const walk = domTextOffsetAtNode(live.el, startContainer, startOffset);
		if (walk < markerPrefixLength(live.el)) placeCaretAtRaw(live.el, 0, { clamp: 'exact' });
	}

	return { getRaw, setRaw, getFocusOffset, getRawSelection, rawRangeOf, clampOutOfMarkerPrefix };
}

// ── Internal ────────────────────────────────────────────────────────────────

function rawEndpointsOf(
	el: HTMLElement,
	range: AbstractRange
): { start: RawOffset; end: RawOffset } {
	return {
		start: rawOffsetAt(el, range.startContainer, range.startOffset),
		end: rawOffsetAt(el, range.endContainer, range.endOffset)
	};
}

/** The live selection as every reader here needs it. A dropped range is its own state because
 *  only the caret read has a snap target to fall back on. */
type LiveRange =
	| { state: 'inactive' }
	| { state: 'dropped' }
	| {
			state: 'live';
			el: HTMLElement;
			range: Range;
			collapsed: boolean;
			inPrefix: (node: Node) => boolean;
	  };

function readLiveRange(el: HTMLElement | null): LiveRange {
	if (!el || document.activeElement !== el) return { state: 'inactive' };
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return { state: 'dropped' };
	const prefix = markerPrefixOf(el);
	return {
		state: 'live',
		el,
		range: sel.getRangeAt(0),
		collapsed: sel.isCollapsed,
		inPrefix: (node) => prefix !== null && prefix.contains(node)
	};
}
