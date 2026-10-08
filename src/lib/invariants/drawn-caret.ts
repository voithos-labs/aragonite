/**
 * G1.76 and G1.77: the drawn caret's bar sits on its caret until something moves the caret, and the
 * attribute hiding the browser's caret sits on exactly the editable the bar draws for.
 */

import type { InvariantViolation } from '../assert';

interface CaretAt {
	node: Node | null;
	offset: number;
	/** The bar's box in its host's pixels, or null where nothing would be drawn now. */
	rect: { x: number; y: number; height: number } | null;
	/** The editable's size, which a reflow changes before its size observer repaints. */
	surfaceSize: string;
}

/** Null unless the caret sits where the bar was painted for and the bar has drifted off it. */
export function checkDrawnCaretAgrees(
	painted: CaretAt & { rect: NonNullable<CaretAt['rect']> },
	now: CaretAt
): InvariantViolation | null {
	if (now.node !== painted.node || now.offset !== painted.offset || !now.rect) return null;
	if (now.surfaceSize !== painted.surfaceSize) return null;
	const off = Math.max(
		Math.abs(now.rect.x - painted.rect.x),
		Math.abs(now.rect.y - painted.rect.y),
		Math.abs(now.rect.height - painted.rect.height)
	);
	if (off <= 1) return null;
	return {
		code: 'drawn-caret-stale',
		message: `the drawn caret sits ${off.toFixed(1)}px from a caret that has not moved since its last paint: something changed the caret's line after the paint, so it must ask the drawn caret to repaint`
	};
}

/** Null when `attribute` marks exactly `drawnFor` under `root`, or nothing when it is null. */
export function checkOneCaretShowing(
	root: HTMLElement,
	attribute: string,
	drawnFor: HTMLElement | null
): InvariantViolation | null {
	const marked = root.querySelectorAll(`[${attribute}]`);
	const ok = drawnFor ? marked.length === 1 && marked[0] === drawnFor : marked.length === 0;
	if (ok) return null;
	return {
		code: 'drawn-caret-class',
		message: `${marked.length} editables hide the browser's caret while the drawn caret draws for ${drawnFor ? 'one' : 'none'}: the mark and the bar change in one paint, so the page shows exactly one caret`
	};
}
