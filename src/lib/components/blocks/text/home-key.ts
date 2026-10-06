/**
 * Home in a text block whose first line opens behind its text, after a container's marker (`- `,
 * `> `) or before a leading widget, where the browser's own line start lands outside the text.
 * Home and Shift+Home go to the start of the caret's line; only on the first line does the editor
 * place that start itself.
 */

import { isAtFirstVisualLine, type CaretBounds } from '../../../cursor/visual-lines';
import {
	extendSelectionToRaw,
	landableStartAbutsIsland,
	markerPrefixOf
} from '../../../cursor/widget-offset';

export interface HomeKeyDeps {
	getEl(): HTMLElement | null;
	/** The first and last offsets a caret can sit at. */
	caretBounds(): CaretBounds;
	/** The selection's moving end in raw offsets, or null when it isn't in this block. */
	getFocusOffset(): number | null;
	/** A collapsed caret at the start of the text, through the clamp every caret placement takes. */
	focusContentStart(): void;
}

/** True when the key was handled here, its default prevented. */
export function handleHomeKey(e: KeyboardEvent, deps: HomeKeyDeps): boolean {
	if (e.key !== 'Home' || e.altKey) return false;
	const el = deps.getEl();
	if (!el || (markerPrefixOf(el) === null && !landableStartAbutsIsland(el))) return false;
	const bounds = deps.caretBounds();
	// Mod+Home goes to the block's start, which is on the first line wherever the caret is.
	const toBlockStart = e.ctrlKey || e.metaKey;
	if (!toBlockStart) {
		const focus = deps.getFocusOffset() ?? bounds.start;
		if (!isAtFirstVisualLine(el, focus, bounds, selectionFocus())) return false;
	}
	e.preventDefault();
	if (e.shiftKey) extendSelectionToRaw(el, bounds.start);
	else deps.focusContentStart();
	return true;
}

// Shift+Home moves the selection's focus, which a forward selection holds below its start.
function selectionFocus(): Range | undefined {
	const sel = window.getSelection();
	if (!sel?.focusNode || sel.isCollapsed) return undefined;
	const range = document.createRange();
	range.setStart(sel.focusNode, sel.focusOffset);
	return range;
}
