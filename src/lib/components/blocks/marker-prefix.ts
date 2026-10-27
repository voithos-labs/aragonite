/**
 * Builds the marker prefix span (the "ambient" prefix): the read-only prefix a container block
 * draws in front of its first prose child's text. Reading it back is `browser/offsets.ts`.
 */

import type { AmbientPrefix } from '../../block-component';
import { DRAG_ANCHOR_ATTR } from '../../caret/block-content-selector';
import { devWarn } from '@voithos-labs/aragonite/dev-checks';

/** The box inside the marker prefix span that editor.css sizes to the hanging indent. */
export const MARKER_BOX_CLASS = 'md-marker-box';

/** The hanging indent a prefix needs when it declares none: one `ch` of its line's font per
 *  character, the width its bytes take in a monospace face. */
export function defaultPrefixIndent(text: string): string {
	return `calc(${text.length} * 1ch)`;
}

export function buildAmbientSpan(prefix: AmbientPrefix): HTMLSpanElement {
	const normalized = typeof prefix === 'string' ? { text: prefix } : prefix;
	const outer = document.createElement('span');
	outer.className = 'md-marker';
	outer.setAttribute('contenteditable', 'false');
	// The hanging indent's width is set on an inline box inside the marker: on the marker itself,
	// Chromium's End in an empty block puts the caret in the marker's text.
	const box = document.createElement('span');
	box.className = MARKER_BOX_CLASS;
	outer.appendChild(box);

	// Document order, whatever order the host listed them in: the walk below is a single pass.
	const ranges = [...(normalized.interactive ?? [])].sort((a, b) => a.start - b.start);
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
			box.appendChild(document.createTextNode(normalized.text.slice(cursor, range.start)));
		}
		const span = document.createElement('span');
		span.className = range.className;
		if (range.role) span.setAttribute('role', range.role);
		if (range.ariaChecked !== undefined) {
			span.setAttribute('aria-checked', String(range.ariaChecked));
		}
		if (range.label !== undefined) span.setAttribute('aria-label', range.label);
		if (range.focusable) span.tabIndex = 0;
		if (range.dragAnchor) span.setAttribute(DRAG_ANCHOR_ATTR, '');
		span.textContent = normalized.text.slice(range.start, range.end);
		span.addEventListener('click', range.onClick);
		const onActivate = range.onActivate;
		if (onActivate) span.addEventListener('keydown', (e) => activateOnKey(e, onActivate));
		box.appendChild(span);
		cursor = range.end;
	}

	if (cursor < normalized.text.length) {
		box.appendChild(document.createTextNode(normalized.text.slice(cursor)));
	}

	return outer;
}

// ── Internal ────────────────────────────────────────────────────────────────

// Enter and Space, the keys a link or button answers; the block below must not see them too.
function activateOnKey(e: KeyboardEvent, onActivate: () => void): void {
	if (e.key !== 'Enter' && e.key !== ' ') return;
	e.preventDefault();
	e.stopPropagation();
	onActivate();
}
