/**
 * Caret reads and writes for prose contenteditable blocks: raw to DOM offset translation and
 * back, accounting for the leading marker span (the "ambient" prefix) a container block draws in
 * front of its first prose child. Blocks with no prefix use this too: `getAmbientLength: () => 0`
 * reduces it to plain widget-aware translation.
 */

import {
	asRawOffset,
	toClampedRawOffset,
	toDomTextOffset,
	type RawOffset
} from '../cursor/coordinate-spaces';
import { domTextOffsetAtNode, findDomTextOffsetTarget } from '../cursor/widget-offset';
import { ambientSpanOf, placeCaretAfterAmbientSpan } from './ambient-dom';

export interface AmbientCursorDeps {
	getEl: () => HTMLElement | null | undefined;
	getAmbientLength: () => number;
	/**
	 * Logical caret position (raw units) when the live DOM range is gone or trapped: the
	 * "user clicked here" intent that survives Chromium dropping element-level carets
	 * across event-loop yields. Null when no snap intent is active.
	 */
	getSnapTarget?: () => number | null;
}

export interface AmbientCursorIO {
	/** Raw offset of the collapsed caret, or null if no selection inside `el`. */
	getRaw(): RawOffset | null;
	/** Move the caret to the given raw offset. Offsets at or before raw 0 land just
	 * after the marker span. */
	setRaw(offset: RawOffset): void;
	/** Raw offsets of the anchor/focus endpoints of the current selection, or null. */
	getRawSelection(): { start: RawOffset; end: RawOffset } | null;
	/** Raw offsets of an arbitrary range inside this block: an InputEvent's target range, which a
	 *  word delete reports at a collapsed caret, so the selection cannot answer it. */
	rawRangeOf(range: AbstractRange): { start: RawOffset; end: RawOffset } | null;
	/** Ensure the caret sits outside the marker prefix. No-op when `el` isn't the
	 * active element or the caret is already out. */
	clampOutOfAmbient(): void;
	/** Put the caret immediately after the marker span, where raw offset 0 lands. */
	setToAmbientBoundary(): void;
}

export function createAmbientCursorIO(deps: AmbientCursorDeps): AmbientCursorIO {
	function snapTargetRaw(): RawOffset | null {
		const target = deps.getSnapTarget?.() ?? null;
		return target === null ? null : asRawOffset(target);
	}

	function readLiveRange(): LiveRange {
		const el = deps.getEl();
		if (!el || document.activeElement !== el) return { state: 'inactive' };
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return { state: 'dropped' };
		const ambient = ambientSpanOf(el);
		return {
			state: 'live',
			el,
			range: sel.getRangeAt(0),
			collapsed: sel.isCollapsed,
			inAmbient: (node) => ambient !== null && ambient.contains(node)
		};
	}

	function getRaw(): RawOffset | null {
		const live = readLiveRange();
		if (live.state === 'inactive') return null;
		// Dropped (Chromium loses element-level carets past atomic widgets) or bounced into a
		// contenteditable=false span: the snap target holds where the user meant to click.
		if (live.state === 'dropped') return snapTargetRaw();
		if (live.inAmbient(live.range.startContainer)) return snapTargetRaw();
		const content = domTextOffsetAtNode(live.el, live.range.startContainer, live.range.startOffset);
		return toClampedRawOffset(content, deps.getAmbientLength());
	}

	function setToAmbientBoundary(): void {
		const el = deps.getEl();
		if (el) placeCaretAfterAmbientSpan(el);
	}

	function setRaw(offset: RawOffset): void {
		const el = deps.getEl();
		if (!el) return;
		const ambientLength = deps.getAmbientLength();
		// Walking to position ambientLength lands inside the marker span, where Chromium
		// bounces the caret out in front of it. Use a sibling boundary instead.
		if (ambientLength > 0 && offset <= 0) {
			setToAmbientBoundary();
			return;
		}
		const target = toDomTextOffset(offset, ambientLength);
		const pos = findDomTextOffsetTarget(el, target);
		if (!pos) return;
		// The walk's last-text-node fallback can land inside the marker text, where the
		// contenteditable="false" span traps the caret.
		const ambient = ambientSpanOf(el);
		if (ambient && ambient.contains(pos.node)) {
			setToAmbientBoundary();
			return;
		}
		const range = document.createRange();
		try {
			range.setStart(pos.node, pos.offset);
		} catch {
			return;
		}
		range.collapse(true);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	function clampOutOfAmbient(): void {
		// Check the live range before reading the prefix length, as every other method here does:
		// the length is derived from the owning block, and a block unmounted mid-dispatch has none.
		const live = readLiveRange();
		if (live.state !== 'live' || !live.collapsed) return;
		const ambientLength = deps.getAmbientLength();
		if (ambientLength === 0) return;
		const content = domTextOffsetAtNode(live.el, live.range.startContainer, live.range.startOffset);
		if (content >= ambientLength) return;
		setToAmbientBoundary();
	}

	function getRawSelection(): { start: RawOffset; end: RawOffset } | null {
		const live = readLiveRange();
		if (live.state !== 'live' || live.collapsed) return null;
		// No snap-target fallback here, unlike `getRaw`: a single caret intent cannot stand
		// in for one end of a pair, and the clamp below already maps the marker interior to
		// raw 0, the right boundary for a drag that began inside the marker.
		return rawEndpointsOf(live.el, live.range, deps.getAmbientLength());
	}

	function rawRangeOf(range: AbstractRange): { start: RawOffset; end: RawOffset } | null {
		const el = deps.getEl();
		if (!el || !el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
		return rawEndpointsOf(el, range, deps.getAmbientLength());
	}

	return { getRaw, setRaw, getRawSelection, rawRangeOf, clampOutOfAmbient, setToAmbientBoundary };
}

// ── Internal ────────────────────────────────────────────────────────────────

function rawEndpointsOf(
	el: HTMLElement,
	range: AbstractRange,
	ambientLength: number
): { start: RawOffset; end: RawOffset } {
	return {
		start: toClampedRawOffset(
			domTextOffsetAtNode(el, range.startContainer, range.startOffset),
			ambientLength
		),
		end: toClampedRawOffset(
			domTextOffsetAtNode(el, range.endContainer, range.endOffset),
			ambientLength
		)
	};
}

/**
 * The preamble every reader of the live native selection shares. A dropped range is its
 * own state because only the caret readers have a snap target to fall back on.
 */
type LiveRange =
	| { state: 'inactive' }
	| { state: 'dropped' }
	| {
			state: 'live';
			el: HTMLElement;
			range: Range;
			collapsed: boolean;
			/** `node` sits inside the marker's contenteditable="false" span. */
			inAmbient: (node: Node) => boolean;
	  };
