/**
 * Ambient-aware cursor I/O for prose contenteditable surfaces. Translates
 * between raw offsets (CST-facing) and DOM offsets (browser-facing) while
 * respecting the leading ambient marker span that container blocks (e.g.
 * list items) contribute to their first prose child.
 *
 * Factory shape — component passes reactive state via getters so each call
 * re-reads live values; capturing by value would snapshot at factory-call time.
 */

import {
	setCursorOffset as setCursorOffsetHelper,
	getCursorOffset as getCursorOffsetHelper,
	getSelectionOffsets as getSelectionOffsetsHelper
} from './cursor-utils';
import { domToRawOffset, rawToDomOffset } from './ambient-offset';
import { placeCaretAfterAmbientSpan } from './ambient-dom';

export interface AmbientCursorDeps {
	getEl: () => HTMLElement | null | undefined;
	getAmbientLength: () => number;
}

export interface AmbientCursorIO {
	/** Raw offset of the collapsed caret, or null if no selection inside `el`. */
	getRaw(): number | null;
	/** Move the caret to the given raw offset. Offsets at/before the ambient
	 * boundary land just after the marker span. */
	setRaw(offset: number): void;
	/** Raw offsets of the anchor/focus endpoints of the current selection, or null. */
	getRawSelection(): { start: number; end: number } | null;
	/** Ensure the caret sits outside the ambient marker region. No-op when `el`
	 * isn't the active element or the caret is already out. */
	clampOutOfAmbient(): void;
	/** Park the caret immediately after the ambient span — used as the raw-0 landing. */
	setToAmbientBoundary(): void;
}

export function createAmbientCursorIO(deps: AmbientCursorDeps): AmbientCursorIO {
	function getRaw(): number | null {
		const el = deps.getEl();
		if (!el) return null;
		const dom = getCursorOffsetHelper(el);
		return dom === null ? null : domToRawOffset(dom, deps.getAmbientLength());
	}

	function setToAmbientBoundary(): void {
		const el = deps.getEl();
		if (el) placeCaretAfterAmbientSpan(el);
	}

	function setRaw(offset: number): void {
		const el = deps.getEl();
		if (!el) return;
		const ambientLength = deps.getAmbientLength();
		// Raw offset 0 under an ambient marker: a container-level DOM offset of
		// ambientLength walks createRangeFromOffsets INTO the marker's text
		// node (which sits inside a contenteditable="false" island) and
		// Chromium bounces the caret out in front of the span. Use a sibling
		// boundary instead.
		if (ambientLength > 0 && offset <= 0) {
			setToAmbientBoundary();
			return;
		}
		setCursorOffsetHelper(el, rawToDomOffset(offset, ambientLength));
	}

	function clampOutOfAmbient(): void {
		const el = deps.getEl();
		if (!el) return;
		const ambientLength = deps.getAmbientLength();
		if (ambientLength === 0) return;
		if (document.activeElement !== el) return;
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
		const dom = getCursorOffsetHelper(el);
		if (dom === null || dom >= ambientLength) return;
		setToAmbientBoundary();
	}

	function getRawSelection(): { start: number; end: number } | null {
		const el = deps.getEl();
		if (!el) return null;
		const dom = getSelectionOffsetsHelper(el);
		if (!dom) return null;
		const ambientLength = deps.getAmbientLength();
		return {
			start: domToRawOffset(dom.start, ambientLength),
			end: domToRawOffset(dom.end, ambientLength)
		};
	}

	return { getRaw, setRaw, getRawSelection, clampOutOfAmbient, setToAmbientBoundary };
}
