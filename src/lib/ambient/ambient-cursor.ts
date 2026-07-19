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

	function getRaw(): RawOffset | null {
		const el = deps.getEl();
		if (!el) return null;
		if (document.activeElement !== el) return null;
		const sel = window.getSelection();
		// rangeCount=0: Chromium drops element-level carets past atomic widgets
		// across event-loop yields. Range inside the ambient marker: the browser
		// rebound the caret into a contenteditable=false island. Either way,
		// the snap target carries the user's actual intent.
		if (!sel || sel.rangeCount === 0) return snapTargetRaw();
		const range = sel.getRangeAt(0);
		const ambient = ambientSpanOf(el);
		if (ambient && ambient.contains(range.startContainer)) {
			return snapTargetRaw();
		}
		const content = domTextOffsetAtNode(el, range.startContainer, range.startOffset);
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
		const el = deps.getEl();
		if (!el) return;
		const ambientLength = deps.getAmbientLength();
		if (ambientLength === 0) return;
		if (document.activeElement !== el) return;
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
		const range = sel.getRangeAt(0);
		const content = domTextOffsetAtNode(el, range.startContainer, range.startOffset);
		if (content >= ambientLength) return;
		setToAmbientBoundary();
	}

	function getRawSelection(): { start: RawOffset; end: RawOffset } | null {
		const el = deps.getEl();
		if (!el) return null;
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed) return null;
		const range = sel.getRangeAt(0);
		const ambientLength = deps.getAmbientLength();
		const start = domTextOffsetAtNode(el, range.startContainer, range.startOffset);
		const end = domTextOffsetAtNode(el, range.endContainer, range.endOffset);
		return {
			start: toClampedRawOffset(start, ambientLength),
			end: toClampedRawOffset(end, ambientLength)
		};
	}

	return { getRaw, setRaw, getRawSelection, clampOutOfAmbient, setToAmbientBoundary };
}
