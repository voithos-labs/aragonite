/**
 * The editor's one writer of the native selection (`docs/design/selection.md`). Every write and
 * clear goes through `createCaretWriter`, which checks each endpoint, remembers the caret it
 * wrote, and asks the drawn caret to repaint.
 */

import {
	type DomPosition,
	caretPointAtRaw,
	clampToLandableRaw,
	containerDomTextLength,
	markerPrefixLength,
	endOfContents,
	walkOffsetOfRaw,
	nearSideOfRunEndingAt,
	rawOfWalkOffset,
	rawOffsetAt
} from './offsets';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { checkCaretBeforeBreak } from '../invariants/caret-before-break';
import { checkCaretOutsideLineEndingPair } from '../invariants/line-ending-pairs';
import { checkLineReadRestored } from '../invariants/line-read-restores';
import { splitsLineEndingPair } from '../core/line-ending-pairs';
import { hiddenSuffixLength, markerPrefixOf, markerHidingMode, mayBeOffCanonical } from './painted';
import { hidesDelimitersAtCaret } from '../presentation-mode';

/** How a caret write treats its offset: `reachable` moves it onto a position the mode lets a caret
 *  sit at (never behind a hidden marker run); `exact` writes it as given. */
export type CaretClamp = 'reachable' | 'exact';

/**
 * The editor's one writer of the native selection, built once per editor. Every write and clear
 * calls `onWrite` after it lands, which asks the drawn caret to repaint; a refused write calls
 * nothing. Methods return false when refused.
 */
export interface CaretWriter {
	/** A collapsed caret at raw `raw` in `el`, past a marker prefix (Chromium bounces one before
	 *  it). Where `declinesCaret` takes the caret (reading mode) it drops the selection instead. */
	placeCaretAtRaw(el: HTMLElement, raw: number, placement: { clamp: CaretClamp }): boolean;
	/** Raw `[anchor, focus]` in `el`, backward when the focus comes first; an endpoint at raw 0
	 *  behind a marker prefix lands after the span, as a caret does. */
	selectRawRange(el: HTMLElement, anchor: number, focus: number): boolean;
	/** Moves the live selection's focus to raw `raw` in `el`, keeping its anchor (one inside a CRLF
	 *  pair moves before it). */
	extendSelectionToRaw(el: HTMLElement, raw: number): boolean;
	/** `el`'s content past its marker prefix and short of a hidden structural suffix (the first
	 *  Ctrl+A, a triple click). With no content, from raw 0's caret to a placeholder `<br>`. */
	selectSurfaceContent(el: HTMLElement): boolean;
	/** The nodes `range` already spans, as a node-level writer holds them (a widget whole). */
	selectDomRange(range: Range): boolean;
	/** Moves a collapsed caret the browser left where the editor never puts one (inside a widget,
	 *  on a hidden run's far side, inside a CRLF pair) to the spot it writes for that pixel. */
	canonicalizeCaret(el: HTMLElement): boolean;
	/** Writes this writer's own caret in `el` again, where it stands, after something beside it
	 *  shows or hides: WebKit keeps a caret resolved against the layout it was placed in. */
	rewriteCaret(el: HTMLElement): boolean;
	/** Moves the caret to its visual line's left or right edge, what macOS's Cmd+Arrow does, for
	 *  an edge site that places the caret where the browser won't. */
	moveCaretToLineEdge(side: 'start' | 'end'): boolean;
	/** Moves the selection's focus to its visual line's edge, keeping the anchor: Cmd+Shift+Arrow. */
	extendToLineEdge(side: 'start' | 'end'): boolean;
	/** Whether the selection's focus ends its visual line as the browser shows it, which a soft
	 *  wrap's one DOM position can't say. A read: nothing is written. Null with no caret. */
	focusEndsLine(): boolean | null;
	/** Drops the native selection: a gap caret, a widget or a whole-block range holds none. */
	clear(): void;
}

/** `declinesCaret` is handed each caret the writer is asked for and answers true where none may
 *  stand (reading mode), taking note of the point if it wants it. */
export function createCaretWriter(
	onWrite: () => void,
	declinesCaret: (el: HTMLElement, raw: number) => boolean
): CaretWriter {
	// The editor's own caret stands wherever it put it; only a caret the browser moved is moved.
	let written: DomPosition | null = null;

	function writeSelection(anchor: DomPosition, focus: DomPosition): boolean {
		assertInvariant(
			'caret-before-break',
			() => checkCaretBeforeBreak(anchor) ?? checkCaretBeforeBreak(focus)
		);
		assertInvariant(
			'caret-in-line-ending-pair',
			() => checkCaretOutsideLineEndingPair(anchor) ?? checkCaretOutsideLineEndingPair(focus)
		);
		const sel = window.getSelection();
		if (!sel) return false;
		try {
			sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
		} catch {
			return false;
		}
		written = sel.isCollapsed ? { node: sel.focusNode!, offset: sel.focusOffset } : null;
		onWrite();
		return true;
	}

	// The browser finds the line's edge; `writeSelection` checks the landing and repaints.
	function modifyToLineEdge(alter: 'move' | 'extend', side: 'start' | 'end'): boolean {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return false;
		sel.modify(alter, side === 'start' ? 'left' : 'right', 'lineboundary');
		const { anchorNode, focusNode } = sel;
		if (!anchorNode || !focusNode) return false;
		const focus = { node: focusNode, offset: sel.focusOffset };
		return writeSelection(
			alter === 'move' ? focus : { node: anchorNode, offset: sel.anchorOffset },
			focus
		);
	}

	// To the line's end and back: a caret the move left alone already ended its line. A range isn't
	// asked: an extend there and back moves the column WebKit's next Shift+arrow keeps.
	function focusEndsLine(): boolean | null {
		const sel = window.getSelection();
		const node = sel?.focusNode;
		if (!sel || !node || !sel.isCollapsed) return null;
		const offset = sel.focusOffset;
		sel.modify('move', 'forward', 'lineboundary');
		if (sel.focusNode === node && sel.focusOffset === offset) return true;
		sel.modify('move', 'backward', 'lineboundary');
		const back = { node: sel.focusNode, offset: sel.focusOffset };
		assertInvariant('line-read-restores-focus', () =>
			checkLineReadRestored({ node, offset }, back)
		);
		if (back.node !== node || back.offset !== offset) sel.collapse(node, offset);
		return false;
	}

	function selectRawRange(el: HTMLElement, anchor: number, focus: number): boolean {
		return writeSelection(caretPointAtRaw(el, anchor), caretPointAtRaw(el, focus));
	}

	function clear(): void {
		const sel = window.getSelection();
		if (!sel) return;
		sel.removeAllRanges();
		written = null;
		onWrite();
	}

	return {
		placeCaretAtRaw(el, raw, { clamp }) {
			if (declinesCaret(el, raw)) {
				clear();
				return false;
			}
			const at = clamp === 'reachable' ? clampToLandableRaw(el, Math.max(0, raw)) : raw;
			const point = caretPointAtRaw(el, at);
			return writeSelection(point, point);
		},
		selectRawRange,
		extendSelectionToRaw(el, raw) {
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0 || sel.anchorNode === null) return false;
			const anchor = { node: sel.anchorNode, offset: sel.anchorOffset };
			// An anchor the browser parked inside a CRLF pair reads as before it, and is kept there.
			if (anchor.node instanceof Text && splitsLineEndingPair(anchor.node.data, anchor.offset)) {
				anchor.offset--;
			}
			return writeSelection(anchor, caretPointAtRaw(el, raw));
		},
		selectSurfaceContent(el) {
			const suffix = hiddenSuffixLength(el);
			const contentLength = containerDomTextLength(el) - markerPrefixLength(el) - suffix;
			if ((markerPrefixOf(el) || suffix > 0) && contentLength > 0) {
				return selectRawRange(el, 0, contentLength);
			}
			return writeSelection(caretPointAtRaw(el, 0), endOfContents(el));
		},
		selectDomRange(range) {
			return writeSelection(
				{ node: range.startContainer, offset: range.startOffset },
				{ node: range.endContainer, offset: range.endOffset }
			);
		},
		canonicalizeCaret(el) {
			const caret = liveCaretIn(el);
			if (!caret) return false;
			if (written?.node === caret.node && written.offset === caret.offset) return false;
			written = null;
			const target = canonicalCaretPoint(el, caret.node, caret.offset);
			return target !== null && writeSelection(target, target);
		},
		rewriteCaret(el) {
			const caret = liveCaretIn(el);
			// Only the editor's own caret: one the browser left is `canonicalizeCaret`'s to judge.
			if (!caret || written?.node !== caret.node || written.offset !== caret.offset) return false;
			return writeSelection(caret, caret);
		},
		moveCaretToLineEdge(side) {
			return modifyToLineEdge('move', side);
		},
		extendToLineEdge(side) {
			return modifyToLineEdge('extend', side);
		},
		focusEndsLine,
		clear
	};
}

/** The browser's collapsed caret, when it sits inside `el`. */
function liveCaretIn(el: HTMLElement): DomPosition | null {
	const sel = window.getSelection();
	const node = sel?.isCollapsed ? sel.focusNode : null;
	return node && el.contains(node) ? { node, offset: sel!.focusOffset } : null;
}

/** The raw offset a browser-left caret at `raw` belongs at: in a mode that never shows a hidden run,
 *  its far side becomes its near side, the same pixel, when content precedes the run on its line. */
function canonicalCaretRaw(el: HTMLElement, raw: number): number {
	const mode = markerHidingMode(el);
	if (mode === null || !hidesDelimitersAtCaret(mode)) return raw;
	const walk = walkOffsetOfRaw(el, raw);
	const near = nearSideOfRunEndingAt(el, walk, mode);
	return near === walk ? raw : rawOfWalkOffset(el, near);
}

/** Where the editor would put a collapsed caret the browser left at `(node, offset)`, or null when
 *  it already sits there. */
function canonicalCaretPoint(el: HTMLElement, node: Node, offset: number): DomPosition | null {
	if (!mayBeOffCanonical(el, node, offset)) return null;
	const target = caretPointAtRaw(el, canonicalCaretRaw(el, rawOffsetAt(el, node, offset)));
	return target.node === node && target.offset === offset ? null : target;
}
