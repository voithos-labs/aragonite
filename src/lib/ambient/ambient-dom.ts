/**
 * Builds the marker prefix span (the "ambient" prefix): the read-only prefix a container block
 * draws in front of its first prose child's text. Reading it back is `cursor/widget-offset.ts`.
 */

import type { AmbientPrefix } from '../block-component';
import { DRAG_ANCHOR_ATTR } from '../components/block-content-selector';
import { devWarn } from '../dev-warn';

export function buildAmbientSpan(prefix: AmbientPrefix): HTMLSpanElement {
	const normalized = typeof prefix === 'string' ? { text: prefix } : prefix;
	const outer = document.createElement('span');
	outer.className = 'md-marker';
	outer.setAttribute('contenteditable', 'false');

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
			outer.appendChild(document.createTextNode(normalized.text.slice(cursor, range.start)));
		}
		const inner = document.createElement('span');
		inner.className = range.className;
		if (range.role) inner.setAttribute('role', range.role);
		if (range.ariaChecked !== undefined) {
			inner.setAttribute('aria-checked', String(range.ariaChecked));
		}
		if (range.label !== undefined) inner.setAttribute('aria-label', range.label);
		if (range.focusable) inner.tabIndex = 0;
		if (range.dragAnchor) inner.setAttribute(DRAG_ANCHOR_ATTR, '');
		inner.textContent = normalized.text.slice(range.start, range.end);
		inner.addEventListener('click', range.onClick);
		const onActivate = range.onActivate;
		if (onActivate) inner.addEventListener('keydown', (e) => activateOnKey(e, onActivate));
		outer.appendChild(inner);
		cursor = range.end;
	}

	if (cursor < normalized.text.length) {
		outer.appendChild(document.createTextNode(normalized.text.slice(cursor)));
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
