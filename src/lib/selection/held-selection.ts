/**
 * Whether the user holds a selection, and where it lies. Every such question asks here: while the
 * editor holds a range or a widget, the browser's own selection is a caret, so a read of the
 * browser's alone takes the user's selection for none (`docs/design/selection.md` § Clipboard).
 */

import {
	holdsNativeRange,
	nativeRangeIn,
	rawSelectionIn,
	readNativeSelection
} from '../browser/selection-read';
import { usesMacEditingConventions } from '../schema/platform-conventions';
import type { SelectionState } from './selection-state.svelte';
import { pressesSelectedWidget } from './widget-press';

type Held = Pick<SelectionState, 'ownsRange' | 'widget'>;
type Painted = Pick<SelectionState, 'ownsRange' | 'isCustomRendered' | 'widgetIn'>;

/** A press that opens a context menu: the right button, or Control with the primary one on a Mac.
 *  Read at the press, since engines differ on whether `contextmenu` comes before its release. */
export function isContextPress(press: Pick<MouseEvent, 'button' | 'ctrlKey'>): boolean {
	return press.button === 2 || (press.button === 0 && press.ctrlKey && usesMacEditingConventions());
}

/** Whether the user holds something Cut and Copy act on: a widget or a range the editor holds, or
 *  the browser's range inside `root`. */
export function holdsSelection(selection: Held, root: HTMLElement): boolean {
	return selection.widget !== null || selection.ownsRange || nativeRangeIn(root);
}

/** Who holds a selected range, if anyone: the editor, or the browser on its own. */
export function rangeHolder(
	selection: Pick<SelectionState, 'ownsRange'>
): 'editor' | 'browser' | null {
	if (selection.ownsRange) return 'editor';
	return holdsNativeRange() ? 'browser' : null;
}

/** The browser's range inside `el` in raw offsets; null for a caret, which costs no walk of `el`. */
export function browserRangeIn(el: HTMLElement): ReturnType<typeof rawSelectionIn> {
	const range = holdsNativeRange() ? rawSelectionIn(el) : null;
	return range && !range.collapsed ? range : null;
}

/** Whether a press lands on the user's selection: the widget the editor holds, or the range as it
 *  is painted. */
export function pressLandsOnSelection(
	selection: Painted,
	root: HTMLElement,
	press: Pick<MouseEvent, 'target' | 'clientX' | 'clientY'>
): boolean {
	return (
		pressesSelectedWidget(selection, press.target) ||
		selectionCoversPoint(selection, root, press.clientX, press.clientY)
	);
}

/** Whether a viewport point lies on the range as the user sees it: the editor's paint over a range
 *  it draws itself, otherwise the browser's own highlight inside `root`. */
export function selectionCoversPoint(
	selection: Pick<SelectionState, 'ownsRange' | 'isCustomRendered'>,
	root: HTMLElement,
	x: number,
	y: number
): boolean {
	if (selection.ownsRange && selection.isCustomRendered) {
		const paint = Array.from(root.querySelectorAll(RANGE_PAINT), (el) =>
			el.getBoundingClientRect()
		);
		return covers(paint, x, y);
	}
	const live = readNativeSelection();
	return !!live && nativeRangeIn(root) && covers(Array.from(live.range.getClientRects()), x, y);
}

// The overlay's boxes over each block and the fill between them (`components/overlays/`).
const RANGE_PAINT = '.selection-overlay';

function covers(rects: readonly DOMRect[], x: number, y: number): boolean {
	return rects.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
}
