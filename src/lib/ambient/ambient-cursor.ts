/**
 * Ambient-aware cursor I/O for prose contenteditable surfaces. Translates
 * between raw offsets (CST-facing) and DOM offsets (browser-facing) while
 * respecting the leading ambient marker span that container blocks (e.g.
 * list items) contribute to their first prose child. Zero-ambient surfaces
 * (e.g. table cells) are first-class consumers — `getAmbientLength: () => 0`
 * reduces the IO to plain widget-aware raw-offset translation.
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
	 * Logical caret position (raw units) when the live DOM range is gone or
	 * trapped — the "user clicked here" intent that survives Chromium dropping
	 * element-level carets across event-loop yields and the walker rebounding
	 * into the ambient marker. Null when no snap intent is active.
	 */
	getSnapTarget?: () => number | null;
}

export interface AmbientCursorIO {
	/** Raw offset of the collapsed caret, or null if no selection inside `el`. */
	getRaw(): RawOffset | null;
	/** Move the caret to the given raw offset. Offsets at/before the ambient
	 * boundary land just after the marker span. */
	setRaw(offset: RawOffset): void;
	/** Raw offsets of the anchor/focus endpoints of the current selection, or null. */
	getRawSelection(): { start: RawOffset; end: RawOffset } | null;
	/** Ensure the caret sits outside the ambient marker region. No-op when `el`
	 * isn't the active element or the caret is already out. */
	clampOutOfAmbient(): void;
	/** Park the caret immediately after the ambient span — used as the raw-0 landing. */
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
		// Dropped range: Chromium loses element-level carets past atomic widgets
		// across event-loop yields. Marker-trapped range: the browser rebound the
		// caret into a contenteditable=false island. Either way, the snap target
		// carries the user's actual intent.
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
		// Raw offset 0 under an ambient marker: walking to position ambientLength
		// lands inside the marker's contenteditable="false" island, where
		// Chromium bounces the caret out in front of the span. Use a sibling
		// boundary instead.
		if (ambientLength > 0 && offset <= 0) {
			setToAmbientBoundary();
			return;
		}
		const target = toDomTextOffset(offset, ambientLength);
		const pos = findDomTextOffsetTarget(el, target);
		if (!pos) return;
		// Walker's last-text-node fallback can land inside the marker text;
		// the contenteditable="false" island traps the caret either way.
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
		const ambientLength = deps.getAmbientLength();
		if (ambientLength === 0) return;
		const live = readLiveRange();
		if (live.state !== 'live' || !live.collapsed) return;
		const content = domTextOffsetAtNode(live.el, live.range.startContainer, live.range.startOffset);
		if (content >= ambientLength) return;
		setToAmbientBoundary();
	}

	function getRawSelection(): { start: RawOffset; end: RawOffset } | null {
		const live = readLiveRange();
		if (live.state !== 'live' || live.collapsed) return null;
		// No snap-target fallback for a marker-trapped endpoint, unlike `getRaw`:
		// the snap target is a single caret intent and cannot stand in for one end
		// of a pair, and the clamp below already maps the marker interior to raw 0
		// — the right boundary for a drag that began inside the marker.
		const ambientLength = deps.getAmbientLength();
		const { el, range } = live;
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

	return { getRaw, setRaw, getRawSelection, clampOutOfAmbient, setToAmbientBoundary };
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * The one preamble every reader of the live native selection shares: `el` holds
 * focus, the browser still has a range, and the marker island is identified. A
 * dropped range is its own answer because only the caret readers have a snap
 * target to fall back on.
 */
type LiveRange =
	| { state: 'inactive' }
	| { state: 'dropped' }
	| {
			state: 'live';
			el: HTMLElement;
			range: Range;
			collapsed: boolean;
			/** `node` sits inside the marker's contenteditable="false" island. */
			inAmbient: (node: Node) => boolean;
	  };
