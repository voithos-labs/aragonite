/**
 * The line-start key in a text block whose first line starts behind a marker (`- `, `- [ ] `,
 * `[^1]: `) or a leading widget, where the browser's own line start lands outside the text. Home
 * and Cmd+Left (with Shift, extending) go to the line's start; only on the first line does the
 * editor place that start itself.
 */

import { isAtFirstVisualLine, type CaretBounds } from '../../../browser/lines';
import { caretEdgeKey } from '../../../schema/keybindings';
import { landableStartAbutsIsland } from '../../../browser/offsets';
import { markerPrefixOf } from '../../../browser/painted';
import { extendWithinBlock, type KeyboardExtendContext } from '../../../selection/keyboard-extend';

export interface HomeKeyDeps {
	getEl(): HTMLElement | null;
	/** The first and last offsets a caret can sit at. */
	caretBounds(): CaretBounds;
	/** The selection's moving end in raw offsets, or null when it isn't in this block. */
	getFocusOffset(): number | null;
	/** A collapsed caret at the start of the text, through the clamp every caret placement takes. */
	focusContentStart(): void;
	/** What Shift+Home extends the selection through. */
	extend: Pick<KeyboardExtendContext, 'caretWriter' | 'caretLanding'>;
}

/** True when the key was handled here, its default prevented. */
export function handleHomeKey(e: KeyboardEvent, deps: HomeKeyDeps): boolean {
	// Mod+Home is the shared keydown's, which a table cell runs too.
	const edge = caretEdgeKey(e);
	if (edge?.to !== 'line' || edge.side !== 'start') return false;
	const el = deps.getEl();
	if (!el || (markerPrefixOf(el) === null && !landableStartAbutsIsland(el))) return false;
	const bounds = deps.caretBounds();
	const focus = deps.getFocusOffset() ?? bounds.start;
	if (!isAtFirstVisualLine(el, focus, bounds, deps.extend.caretWriter)) return false;
	e.preventDefault();
	if (edge.extend) extendWithinBlock(deps.extend, el, bounds.start);
	else deps.focusContentStart();
	return true;
}
