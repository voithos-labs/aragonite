/**
 * The caret a widget selected whole keeps. Text that arrives with no key (a soft keyboard,
 * dictation, an emoji picker, an IME) goes only to a selection, so the browser holds a collapsed
 * caret at the widget's edge in its focused block. Nothing shows it and no read answers it
 * (`docs/design/selection.md`).
 */

import type { CaretWriter } from '../browser/caret-writer';
import type { BlockElLookup } from '../caret/block-el-lookup';
import type { SelectionState } from './selection-state.svelte';

/** Writes the selected widget's caret, or drops the browser's selection where none can stand:
 *  an unfocused or unmounted block, reading mode. */
export function writeWidgetCaret(
	selection: Pick<SelectionState, 'widgetCaret'>,
	writer: CaretWriter,
	blockElAt: BlockElLookup
): void {
	const at = selection.widgetCaret();
	const el = at && blockElAt(at.path);
	const focused = !!el && document.activeElement === el;
	if (!at || !focused || !writer.placeUnshownCaret(el, at.offset)) {
		writer.clear();
	}
}
