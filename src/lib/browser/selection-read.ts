/**
 * The reads of the browser's selection the rest of the editor calls: the live selection, its
 * ends as raw offsets, and the text it shows. Engines differ in what the selection reports, so
 * a quirk is fixed here once (`docs/design/editor.md` § Browser engines).
 */

import { type DomPosition, rawOffsetAt } from './offsets';
import type { RawOffset } from '../core/coordinate-spaces';
import { normalizeLineEndings } from '../core/lines';
import { placeholderBreakOf } from './placeholder-break';
import { isBreakAnchor } from './painted';

/** One read of the browser's selection; `range` is its first range, still live. */
export interface NativeSelectionRead {
	anchor: DomPosition;
	focus: DomPosition;
	collapsed: boolean;
	range: Range;
}

/** The live selection, or null when the browser holds no range. */
export function readNativeSelection(): NativeSelectionRead | null {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
	return {
		anchor: { node: sel.anchorNode, offset: sel.anchorOffset },
		focus: { node: sel.focusNode, offset: sel.focusOffset },
		collapsed: sel.isCollapsed,
		range: sel.getRangeAt(0)
	};
}

/** The live selection's range ends in raw offsets inside `el`, in document order, each null where
 *  that end sits outside `el`; null only when the browser holds no range. */
export function rawSelectionIn(
	el: HTMLElement
): { start: RawOffset | null; end: RawOffset | null; collapsed: boolean } | null {
	const live = readNativeSelection();
	if (!live) return null;
	const { range, collapsed } = live;
	const rawAt = (node: Node, offset: number) =>
		el.contains(node) ? rawOffsetAt(el, node, offset) : null;
	const start = rawAt(range.startContainer, range.startOffset);
	return { start, end: collapsed ? start : rawAt(range.endContainer, range.endOffset), collapsed };
}

/** Whether the browser holds a selected range anywhere in the document. */
export function holdsNativeRange(): boolean {
	return window.getSelection()?.isCollapsed === false;
}

/** Whether the browser holds a selected range that starts inside `root`. */
export function nativeRangeIn(root: HTMLElement): boolean {
	const live = readNativeSelection();
	return !!live && !live.collapsed && root.contains(live.anchor.node);
}

/** The browser's selection string, which leaves out what CSS hides, with LF line breaks (Firefox on
 *  Windows writes CRLF), and empty for an empty block's placeholder `<br>` selected alone. */
export function shownSelectionText(): string {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return '';
	const text = normalizeLineEndings(selection.toString());
	const last = selection.getRangeAt(selection.rangeCount - 1);
	return selectsOnlyPlaceholderBreak(last) && text.endsWith('\n') ? text.slice(0, -1) : text;
}

// A range from an earlier block keeps its last break: Chromium writes the block boundary there
// and nothing for the `<br>`, so the two can't be told apart.
function selectsOnlyPlaceholderBreak(range: Range): boolean {
	const before = range.endContainer.childNodes[range.endOffset - 1];
	const parent = before?.parentNode;
	return (
		before instanceof HTMLBRElement &&
		!!parent &&
		parent.contains(range.startContainer) &&
		placeholderBreakOf(parent) === before
	);
}

/** Raw offset of the live selection's focus inside `el`, or null when there is no selection or
 *  its focus sits outside `el`. */
export function rawSelectionFocus(el: HTMLElement): RawOffset | null {
	const sel = window.getSelection();
	if (!sel || sel.focusNode === null || !el.contains(sel.focusNode)) return null;
	return rawOffsetAt(el, sel.focusNode, sel.focusOffset);
}

/** The caret as a raw offset while `el` owns focus, read before an imperative rebuild (a
 *  decoration's) so the caret can be written back after it; null when `el` does not own focus. */
export function captureFocusedCaret(el: HTMLElement): RawOffset | null {
	if (!document.activeElement || !el.contains(document.activeElement)) return null;
	return rawSelectionFocus(el);
}

/** Whether the collapsed caret in `el` is on a line a pending hard break opened: right after one
 *  of its anchors, where the caret on the text's own line never sits. */
export function caretOnPendingBreakLine(el: HTMLElement): boolean {
	const sel = window.getSelection();
	const node = sel?.focusNode;
	if (!sel?.isCollapsed || !node || !el.contains(node)) return false;
	let before: Node | null;
	if (node.nodeType !== Node.TEXT_NODE) before = node.childNodes[sel.focusOffset - 1] ?? null;
	else if (sel.focusOffset > 0) return false;
	else {
		// The start of a text node: what precedes it, climbing out of the spans it opens.
		let at: Node = node;
		while (!at.previousSibling && at.parentNode && at.parentNode !== el) at = at.parentNode;
		before = at.previousSibling;
	}
	while (before?.nodeType === Node.TEXT_NODE && (before.textContent?.length ?? 0) === 0) {
		before = before.previousSibling;
	}
	return isBreakAnchor(before);
}
