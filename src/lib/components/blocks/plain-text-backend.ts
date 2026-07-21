/**
 * The zero-ambient, widget-free surface backend shared by CodeBlock and the
 * `editable-leaf` seam. Such a surface has no ambient marker and renders no inline
 * widgets, so its DOM-text space IS its raw space: every caret read/write door-mints
 * straight across the two coordinate brands, minted once here rather than at each
 * surface. Surfaces with an ambient marker (TextEditableBlock) use the ambient IO.
 */

import type { CursorBackend } from './editable-surface';
import { asDomTextOffset, asRawOffset, type RawOffset } from '../../cursor/coordinate-spaces';
import {
	createRangeFromOffsets,
	setCursorOffset,
	getCursorOffset,
	getSelectionFocusOffset
} from '../../cursor/content-offsets';

export interface ContentOffsetBackend {
	backend: CursorBackend;
	getFocusOffset: () => RawOffset | null;
	getTextLen: () => number;
	readText: () => string;
}

export function createContentOffsetBackend(getEl: () => HTMLElement | null): ContentOffsetBackend {
	return {
		backend: {
			getRaw: () => {
				const el = getEl();
				const offset = el ? getCursorOffset(el) : null;
				return offset === null ? null : asRawOffset(offset);
			},
			setRaw: (offset) => {
				const el = getEl();
				if (el) setCursorOffset(el, asDomTextOffset(offset));
			},
			buildRange: (start, end) => {
				const el = getEl();
				return el ? createRangeFromOffsets(el, asDomTextOffset(start), asDomTextOffset(end)) : null;
			}
		},
		getFocusOffset: () => {
			const el = getEl();
			const offset = el ? getSelectionFocusOffset(el) : null;
			return offset === null ? null : asRawOffset(offset);
		},
		getTextLen: () => (getEl()?.textContent ?? '').length,
		readText: () => getEl()?.textContent ?? ''
	};
}

/**
 * Chromium with `white-space: pre` won't paint a caret on the line after a trailing
 * `\n` unless something follows it; typed text routes before the `\n`. A trailing
 * `<br>` anchors the caret on the new line without touching `textContent` (BR has
 * empty textContent, so `textContent === trimTrailingLineEnding(raw)` still holds).
 */
export function anchorTrailingNewline(el: HTMLElement): void {
	if (!el.textContent?.endsWith('\n')) return;
	const anchor = document.createElement('br');
	anchor.dataset.caretAnchor = '';
	el.appendChild(anchor);
}
