// The image and text-block readers' view of the widget the selection state holds. It keeps no state
// of its own, so it can't disagree with the store; it goes once those readers take the selection
// state itself (T21 slice 1b).

import { selectWidgetWhole } from '../../selection/caret-doors';
import { pathsEqual } from '../../selection/path-math';
import { findSurfacePathForElement } from '../../selection/path-lookup';
import type { WidgetTarget } from '../../selection/primitives';
import type { SelectionState } from '../../selection/selection-state.svelte';

/** What a click-outside handler must not count as outside: the widget itself and the overlay
 *  controls attached to it. */
export const IMAGE_CHROME_SELECTOR = '[data-image-widget], [data-image-overlay]';

/** Whether a press should end the image selection, for both click-outside handlers. A Shift-press
 *  on this editor's text is left to that block, which grows a range from the image and ends it. */
export function pressLeavesImage(press: PointerEvent, editorRoot: Element | null): boolean {
	const target = press.target instanceof Element ? press.target : null;
	if (target?.closest(IMAGE_CHROME_SELECTOR)) return false;
	const ownedByBlock =
		press.shiftKey && !!editorRoot?.contains(target) && findSurfacePathForElement(target) !== null;
	return !ownedByBlock;
}

export interface WidgetSelectionState {
	getSelected(): WidgetTarget | null;
	select(target: WidgetTarget): void;
	/** Ends a selected widget; with none selected, touches nothing else the store holds. */
	clear(): void;
	followEdit(paragraphPath: number[], editEnd: number, delta: number): void;
	isSelected(paragraphPath: number[], sourceStart: number): boolean;
}

export function createWidgetSelectionState(selection: SelectionState): WidgetSelectionState {
	return {
		getSelected: () => selection.widget,
		select: (target) => selectWidgetWhole(selection, target),
		clear: () => {
			if (selection.widget !== null) selection.clear();
		},
		followEdit: (path, editEnd, delta) => selection.followWidgetEdit(path, editEnd, delta),
		isSelected: (path, start) => {
			const widget = selection.widget;
			return (
				widget !== null && widget.sourceStart === start && pathsEqual(widget.paragraphPath, path)
			);
		}
	};
}
