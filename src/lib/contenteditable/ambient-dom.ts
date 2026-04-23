/**
 * DOM-shape helpers for the ambient prefix contract. The ambient marker is
 * rendered by TextEditableBlock.buildInlineDOM as a contenteditable="false"
 * span.md-marker at the start of the editable surface; selection capture,
 * cursor landing, and future click-target logic all need to locate / skip /
 * land-after this span.
 */

import type { AmbientPrefix } from '../contracts';

/**
 * Construct the ambient marker span for `prefix`. String inputs produce a
 * text-only span; object inputs wrap each interactive range in a nested span
 * that carries its className, ARIA hints, and click handler, with the gaps
 * between ranges rendered as plain text nodes.
 */
export function buildAmbientSpan(prefix: AmbientPrefix): HTMLSpanElement {
	const normalized = typeof prefix === 'string' ? { text: prefix } : prefix;
	const outer = document.createElement('span');
	outer.className = 'md-marker';
	outer.setAttribute('contenteditable', 'false');

	const ranges = normalized.interactive ?? [];
	let cursor = 0;

	for (const range of ranges) {
		if (import.meta.env.DEV) {
			if (range.start < 0 || range.end > normalized.text.length || range.start >= range.end) {
				console.warn('[ambient-span] interactive range out of bounds or empty', {
					range,
					textLength: normalized.text.length
				});
				continue;
			}
		}
		if (range.start > cursor) {
			outer.appendChild(document.createTextNode(normalized.text.slice(cursor, range.start)));
		}
		const inner = document.createElement('span');
		inner.className = range.className;
		if (range.role) inner.setAttribute('role', range.role);
		if (range.ariaChecked !== undefined) {
			inner.setAttribute('aria-checked', String(range.ariaChecked));
		}
		inner.textContent = normalized.text.slice(range.start, range.end);
		inner.addEventListener('click', range.onClick);
		outer.appendChild(inner);
		cursor = range.end;
	}

	if (cursor < normalized.text.length) {
		outer.appendChild(document.createTextNode(normalized.text.slice(cursor)));
	}

	return outer;
}

/** Returns the ambient marker span if `blockEl` leads with one; null otherwise. */
export function ambientSpanOf(blockEl: HTMLElement): HTMLElement | null {
	const first = blockEl.firstChild;
	if (!first || first.nodeType !== Node.ELEMENT_NODE) return null;
	const span = first as HTMLElement;
	if (!span.classList.contains('md-marker')) return null;
	if (span.getAttribute('contenteditable') !== 'false') return null;
	return span;
}

/** Length of `blockEl`'s ambient prefix in characters, or 0 if no ambient span. */
export function ambientLengthOf(blockEl: HTMLElement): number {
	return ambientSpanOf(blockEl)?.textContent?.length ?? 0;
}

/**
 * Place a collapsed caret at the sibling boundary immediately after the
 * ambient marker span (raw offset 0). Prefer the start of the first text node
 * past the span so visual-line geometry returns real rects; fall back to
 * setStartAfter when the span is the only child (empty-item state). Returns
 * true on success, false when the block has no ambient span.
 */
export function placeCaretAfterAmbientSpan(blockEl: HTMLElement): boolean {
	const span = ambientSpanOf(blockEl);
	if (!span) return false;
	const range = document.createRange();
	const textAfter = firstTextNodeAfter(span);
	if (textAfter) {
		range.setStart(textAfter, 0);
	} else {
		range.setStartAfter(span);
	}
	range.collapse(true);
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
	return true;
}

// ── Internal ────────────────────────────────────────────────────────────────

function firstTextNodeAfter(node: Node): Text | null {
	let sibling = node.nextSibling;
	while (sibling) {
		const text = firstTextDescendant(sibling);
		if (text) return text;
		sibling = sibling.nextSibling;
	}
	return null;
}

function firstTextDescendant(node: Node): Text | null {
	if (node.nodeType === Node.TEXT_NODE && (node.textContent?.length ?? 0) > 0) {
		return node as Text;
	}
	for (const child of node.childNodes) {
		const found = firstTextDescendant(child);
		if (found) return found;
	}
	return null;
}
