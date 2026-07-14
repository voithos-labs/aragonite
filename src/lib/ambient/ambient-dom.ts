/**
 * DOM construction and lookup for the ambient marker span — the read-only
 * prefix container blocks contribute to their first prose child's textContent.
 */

import type { AmbientPrefix } from '../block-component';
import { devWarn } from '../dev-warn';

export function buildAmbientSpan(prefix: AmbientPrefix): HTMLSpanElement {
	const normalized = typeof prefix === 'string' ? { text: prefix } : prefix;
	const outer = document.createElement('span');
	outer.className = 'md-marker';
	outer.setAttribute('contenteditable', 'false');

	const ranges = normalized.interactive ?? [];
	let cursor = 0;

	for (const range of ranges) {
		if (range.start < 0 || range.end > normalized.text.length || range.start >= range.end) {
			devWarn('ambient-span', 'interactive range out of bounds or empty', {
				range,
				textLength: normalized.text.length
			});
			continue;
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

export function ambientSpanOf(blockEl: ParentNode): HTMLElement | null {
	const first = blockEl.firstChild;
	if (!first || first.nodeType !== Node.ELEMENT_NODE) return null;
	const span = first as HTMLElement;
	if (!span.classList.contains('md-marker')) return null;
	if (span.getAttribute('contenteditable') !== 'false') return null;
	return span;
}

export function ambientLengthOf(blockEl: HTMLElement): number {
	return ambientSpanOf(blockEl)?.textContent?.length ?? 0;
}

export function placeCaretAfterAmbientSpan(blockEl: HTMLElement): boolean {
	const span = ambientSpanOf(blockEl);
	if (!span) return false;
	const range = document.createRange();
	// Prefer the start of the first text node after the span so visual-line
	// geometry returns real rects; setStartAfter yields a collapsed range with
	// no textbox in empty-item state.
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
